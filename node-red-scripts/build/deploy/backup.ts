import * as fs from 'fs';
import * as path from 'path';

const BACKUP_DIR = '/Volumes/config/node-red-scripts/backups';
const MAX_BACKUPS = 10;
const FLOWS_PATH = '/Volumes/addon_configs/a0d7b954_nodered/flows.json';

export interface BackupResult {
  success: boolean;
  filename?: string;
  error?: string;
}

export async function createBackup(): Promise<BackupResult> {
  try {
    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    
    // Create backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `flows_${timestamp}.json`);
    
    // Copy flows file
    fs.copyFileSync(FLOWS_PATH, backupFile);
    
    // Rotate old backups
    await rotateBackups();
    
    return {
      success: true,
      filename: backupFile
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function rotateBackups(): Promise<void> {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('flows_') && f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(BACKUP_DIR, f),
      mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  
  // Delete old backups
  while (files.length > MAX_BACKUPS) {
    const oldFile = files.pop();
    if (oldFile) {
      fs.unlinkSync(oldFile.path);
    }
  }
}

export async function restoreBackup(backupFile: string): Promise<BackupResult> {
  try {
    const backupPath = path.join(BACKUP_DIR, backupFile);
    
    if (!fs.existsSync(backupPath)) {
      return {
        success: false,
        error: 'Backup file not found'
      };
    }
    
    // Create a backup of current state before restoring
    await createBackup();
    
    // Restore the backup
    fs.copyFileSync(backupPath, FLOWS_PATH);
    
    return {
      success: true,
      filename: backupPath
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export interface BackupInfo {
  filename: string;
  timestamp: Date;
  size: number;
  humanDate: string;
  relativeTime: string;
}

export function listBackups(): string[] {
  if (!fs.existsSync(BACKUP_DIR)) {
    return [];
  }
  
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('flows_') && f.endsWith('.json'))
    .sort()
    .reverse();
}

export function getBackupInfo(): BackupInfo[] {
  if (!fs.existsSync(BACKUP_DIR)) {
    return [];
  }
  
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('flows_') && f.endsWith('.json'))
    .map(filename => {
      const filePath = path.join(BACKUP_DIR, filename);
      const stats = fs.statSync(filePath);
      const timestamp = stats.mtime;
      
      // Extract timestamp from filename if possible, otherwise use file mtime
      let backupDate = timestamp;
      const timestampMatch = filename.match(/flows_(.+)\.json$/);
      if (timestampMatch) {
        try {
          const timeStr = timestampMatch[1];
          // Handle ISO format: flows_2025-07-30T20-50-31-789Z.json
          if (timeStr.includes('T') && timeStr.includes('Z')) {
            const isoString = timeStr.replace(/-(\d{3})Z$/, '.$1Z').replace(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/, '$1-$2-$3T$4:$5:$6');
            backupDate = new Date(isoString);
          }
          // Handle other formats like flows_backup_20250803_174909.json
          else if (timeStr.includes('_')) {
            const parts = timeStr.split('_');
            if (parts.length >= 2) {
              const dateStr = parts[parts.length - 2]; // 20250803
              const timeStr = parts[parts.length - 1]; // 174909
              if (dateStr.length === 8 && timeStr.length === 6) {
                const year = dateStr.substring(0, 4);
                const month = dateStr.substring(4, 6);
                const day = dateStr.substring(6, 8);
                const hour = timeStr.substring(0, 2);
                const minute = timeStr.substring(2, 4);
                const second = timeStr.substring(4, 6);
                backupDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
              }
            }
          }
          
          // Validate the parsed date
          if (isNaN(backupDate.getTime())) {
            backupDate = timestamp;
          }
        } catch {
          backupDate = timestamp;
        }
      }
      
      return {
        filename,
        timestamp: backupDate,
        size: stats.size,
        humanDate: backupDate.toLocaleString(),
        relativeTime: getRelativeTime(backupDate)
      };
    })
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
  return backups;
}

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

export async function selectAndRestoreBackup(): Promise<BackupResult> {
  const backups = getBackupInfo();
  
  if (backups.length === 0) {
    return {
      success: false,
      error: 'No backups available'
    };
  }
  
  console.log('\nAvailable backups:');
  console.log('═'.repeat(80));
  
  backups.forEach((backup, index) => {
    const sizeKB = Math.round(backup.size / 1024);
    console.log(`${index + 1}. ${backup.filename}`);
    console.log(`   ${backup.humanDate} (${backup.relativeTime})`);
    console.log(`   ${sizeKB}KB`);
    console.log('');
  });
  
  console.log('0. Cancel restore operation');
  console.log('═'.repeat(80));
  
  // For now, return a function that can be called with the selection
  // In a real CLI implementation, this would prompt for user input
  console.log('\nInteractive selection not yet implemented.');
  console.log('Use: npm run deploy -- --restore-backup <filename>');
  console.log('Available files:');
  backups.forEach((backup, index) => {
    console.log(`  ${index + 1}. ${backup.filename}`);
  });
  
  return {
    success: false,
    error: 'Interactive selection not implemented - use --restore-backup <filename> flag'
  };
}