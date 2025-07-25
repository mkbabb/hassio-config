import * as fs from 'fs';
import * as path from 'path';

const BACKUP_DIR = '/Volumes/config/node-red-backups';
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

export function listBackups(): string[] {
  if (!fs.existsSync(BACKUP_DIR)) {
    return [];
  }
  
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('flows_') && f.endsWith('.json'))
    .sort()
    .reverse();
}