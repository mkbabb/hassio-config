/**
 * Node-RED TypeScript Build Orchestrator
 *
 * Main entry point for the incremental build system. Compiles TypeScript automation
 * functions to JavaScript for deployment to Node-RED, with intelligent caching,
 * dependency tracking, and watch mode support.
 *
 * Architecture:
 * - BuildManager: Core orchestration class handling file builds and cache management
 * - DependencyGraph: Tracks import relationships for smart incremental compilation
 * - esbuild: Bundles each function with dependencies into self-contained IIFE
 * - Cache: MD5-based change detection with 24hr staleness window
 * - Watch mode: Chokidar file monitoring with automatic rebuilds
 *
 * Key features:
 * - Incremental compilation: Only rebuilds changed files and their dependents
 * - Build contexts: Reuses esbuild contexts for faster successive builds
 * - CommonJS cleanup: Strips module.exports artifacts for Node-RED compatibility
 * - Auto-deployment: Optional Node-RED API deployment after builds
 * - Mapping generation: AI-powered function-to-file reconciliation
 *
 * CLI usage:
 *   npm run build              # Build all changed files
 *   npm run watch              # Watch mode with auto-rebuild
 *   npm run build -- --deploy  # Build + deploy to Node-RED
 *   npm run map -- --ai        # Generate function mappings with AI
 *
 * @module build/index
 *
 * @example
 * // Standard build workflow:
 * const buildManager = new BuildManager('src', 'dist', CACHE_STALE_TIME);
 * const builtFiles = await buildManager.buildFiles();
 * await buildManager.dispose();
 *
 * @example
 * // Watch mode with auto-rebuild:
 * const buildManager = new BuildManager('src', 'dist', CACHE_STALE_TIME);
 * await buildManager.startWatching();
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import { writeFile, readFile, mkdir } from "fs/promises";
import chalk from "chalk";
import { StyleHelper } from "./style";
import chokidar from "chokidar";
import * as esbuild from "esbuild";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { config as loadEnv } from "dotenv";
import { generateMappingFile } from "./deploy/mappings/mapper";
import { Deployer } from "./deploy/deploy";
import { DependencyGraph } from "./dependency-graph";
import {
    BuildCache,
    CacheEntry,
    CACHE_STALE_TIME,
    DEFAULT_BLACKLIST,
    RETURN_MSG,
    calculateHash,
    emptyDirectory,
    extractDependencies,
    getFiles,
    getOutputPath,
    getRelativePath,
    loadCache,
    removeOutputFile,
    saveCache
} from "./utils";

// Load environment variables from .env
loadEnv();

/**
 * CLI argument configuration.
 *
 * Supported options:
 * - inputDir (-i): Source directory (default: "src")
 * - outputDir (-o): Compiled output directory (default: "dist")
 * - emptyOutDir: Clean output before build (default: false)
 * - recursive (-r): Recursive file search (default: false)
 * - watch (-w): Watch mode for auto-rebuild (default: false)
 * - cacheTime (-c): Cache staleness time in ms (default: 24hr)
 * - debug (-d): Enable verbose logging (default: false)
 * - deploy: Deploy to Node-RED after build (default: false)
 * - dry-run: Preview deployment without changes (default: false)
 * - map: Generate function mappings (default: false)
 * - ai: Enable AI reconciliation for mappings (default: false)
 */
const argv = yargs(hideBin(process.argv))
    .option("inputDir", {
        alias: "i",
        type: "string",
        default: "src",
        describe: "Specify the input directory"
    })
    .option("outputDir", {
        alias: "o",
        type: "string",
        default: "dist",
        describe: "Specify the output directory"
    })
    .option("emptyOutDir", {
        type: "boolean",
        default: false,
        describe: "Empty the output directory before building"
    })
    .option("recursive", {
        alias: "r",
        type: "boolean",
        default: false,
        describe: "Recursively search for files"
    })
    .option("watch", {
        alias: "w",
        type: "boolean",
        default: false,
        describe: "Watch for file changes"
    })
    .option("cacheTime", {
        alias: "c",
        type: "number",
        default: CACHE_STALE_TIME,
        describe: "Time in milliseconds before cache entries go stale"
    })
    .option("debug", {
        alias: "d",
        type: "boolean",
        default: false,
        describe: "Enable debug logging"
    })
    .option("deploy", {
        type: "boolean",
        default: false,
        describe: "Deploy to Node-RED after build"
    })
    .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "Preview deployment without making changes"
    })
    .option("map", {
        type: "boolean",
        default: false,
        describe: "Generate Node-RED function mappings"
    })
    .help()
    .alias("help", "h")
    .parseSync();

const { inputDir, outputDir, emptyOutDir, recursive, watch, cacheTime, debug, deploy, "dry-run": dryRun, map } = argv;
const ai = (argv as any).ai;

/**
 * Incremental Build Manager
 *
 * Orchestrates TypeScript to JavaScript compilation with intelligent caching,
 * dependency tracking, and watch mode support. Maintains esbuild contexts for
 * faster successive builds and tracks file hashes to avoid unnecessary rebuilds.
 *
 * Rebuild logic:
 * 1. Check if output file exists - rebuild if missing
 * 2. Compare MD5 hash with cache - rebuild if changed
 * 3. Check dependency timestamps - rebuild if deps changed
 * 4. Check cache staleness - rebuild after 24hr window
 *
 * Dependency tracking:
 * - Extracts imports from esbuild metafile
 * - Maintains bidirectional dependency graph
 * - Rebuilds downstream dependents on change
 *
 * esbuild context management:
 * - Creates incremental build contexts for each file
 * - Reuses contexts for faster rebuilds
 * - Disposes contexts on file deletion or cache cleanup
 *
 * @class BuildManager
 *
 * @property {BuildCache} cache - MD5 hash cache with timestamps and dependencies
 * @property {DependencyGraph} dependencyGraph - Bidirectional import relationship tracker
 * @property {Map} esbuildContext - Persistent build contexts for incremental builds
 *
 * @example
 * const manager = new BuildManager('src', 'dist', 86400000);
 * await manager.initialize();
 * const builtFiles = await manager.buildFiles();
 * await manager.dispose();
 */
class BuildManager {
    private cache: BuildCache = {};
    private dependencyGraph = new DependencyGraph();
    private esbuildContext: Map<string, esbuild.BuildContext> = new Map();

    /**
     * Creates a new build manager instance.
     *
     * @param inputDir - Source directory containing TypeScript files
     * @param outputDir - Output directory for compiled JavaScript
     * @param cacheTime - Time in milliseconds before cache entries go stale (default: 24hr)
     */
    constructor(
        private inputDir: string,
        private outputDir: string,
        private cacheTime: number
    ) {}

    /**
     * Initializes the build manager by loading cache and rebuilding dependency graph.
     * Must be called before buildFiles() on a fresh instance.
     *
     * Reconstruction process:
     * 1. Loads persisted cache from build-cache.json
     * 2. Rebuilds dependency graph from cached dependency arrays
     * 3. Validates all cached file paths still exist
     *
     * @returns Promise that resolves when initialization is complete
     */
    async initialize(): Promise<void> {
        this.cache = await loadCache(debug);
        
        // Rebuild dependency graph from cache
        for (const [filePath, entry] of Object.entries(this.cache)) {
            if (entry.dependencies) {
                for (const dependency of entry.dependencies) {
                    this.dependencyGraph.addDependency(filePath, dependency, debug);
                }
            }
        }
        
        if (debug) {
            console.log(chalk.gray("Dependency graph rebuilt from cache"));
            this.dependencyGraph.printGraph();
        }
    }

    /**
     * Determines if a file needs to be rebuilt.
     *
     * Checks four conditions (in order):
     * 1. Output file existence - rebuild if dist file missing
     * 2. MD5 hash match - rebuild if source content changed
     * 3. Cache staleness - rebuild after 24hr window
     * 4. Dependency changes - rebuild if any imported files changed
     *
     * @param filePath - Absolute path to source TypeScript file
     * @returns true if rebuild required, false if cached output is valid
     *
     * @private
     */
    private needsRebuild(filePath: string): boolean {
        const outputPath = getOutputPath(filePath, this.inputDir, this.outputDir);

        if (!existsSync(outputPath)) {
            this.logDebug(`${filePath} needs rebuild: Output doesn't exist`);
            return true;
        }

        const currentHash = calculateHash(filePath);
        const cacheEntry = this.cache[filePath];

        if (!cacheEntry) {
            this.logDebug(`${filePath} needs rebuild: No cache entry`);
            return true;
        }

        const reasons = this.checkRebuildReasons(filePath, cacheEntry, currentHash);
        
        if (reasons.length > 0) {
            reasons.forEach(reason => this.logDebug(`${filePath} needs rebuild: ${reason}`));
            return true;
        }

        this.logDebug(`${filePath} doesn't need rebuild: No changes detected`);
        return false;
    }

    private checkRebuildReasons(_filePath: string, cacheEntry: CacheEntry, currentHash: string): string[] {
        const reasons: string[] = [];
        const currentTime = Date.now();

        if (currentTime - cacheEntry.lastChecked > this.cacheTime) {
            reasons.push("Cache entry is stale");
        }

        if (currentHash !== cacheEntry.hash) {
            reasons.push("File content changed");
        }

        if (this.hasDependencyChanged(cacheEntry)) {
            reasons.push("Dependency changed");
        }

        return reasons;
    }

    private hasDependencyChanged(cacheEntry: CacheEntry): boolean {
        if (!cacheEntry.dependencies) return false;

        for (const dependency of cacheEntry.dependencies) {
            if (!existsSync(dependency)) {
                return true;
            }

            const depHash = calculateHash(dependency);
            const depEntry = this.cache[dependency];
            
            if (!depEntry || depHash !== depEntry.hash) {
                return true;
            }
        }

        return false;
    }

    private updateCache(filePath: string, hash: string, dependencies: string[]): void {
        this.cache[filePath] = {
            hash,
            lastChecked: Date.now(),
            dependencies
        };
    }

    /**
     * Compiles a single TypeScript file to JavaScript.
     *
     * Build process:
     * 1. Check for existing esbuild context (incremental build)
     * 2. If no context, create new context with IIFE bundling
     * 3. Extract dependencies from metafile
     * 4. Process output: strip CommonJS, ensure "return msg;" footer
     * 5. Skip utility modules (no executable code)
     * 6. Update cache with MD5 hash and dependencies
     *
     * Output format:
     * - IIFE bundle with all dependencies inlined
     * - CommonJS artifacts removed (module.exports, Object.defineProperty)
     * - "return msg;" appended for Node-RED compatibility
     * - Utility modules (only exports) are skipped (no output file)
     *
     * @param inputFile - Absolute path to TypeScript source file
     * @returns Output file path on success, null on error or if skipped
     *
     * @example
     * await buildManager.buildFile('src/presence/presence.ts');
     * // Compiles to dist/presence/presence.js with dependencies bundled
     */
    async buildFile(inputFile: string): Promise<string | null> {
        const startTime = Date.now();
        const relativePath = getRelativePath(inputFile, this.inputDir);
        
        try {
            console.log(StyleHelper.building(relativePath));
            const name = relativePath.replace(/\.ts$/, "");
            const outputPath = join(this.outputDir, `${name}.js`);

            let result: string | null;
            
            // Try incremental build first
            if (this.esbuildContext.has(inputFile)) {
                result = await this.incrementalBuild(inputFile, outputPath);
            } else {
                // Create new build context
                result = await this.createAndBuild(inputFile, outputPath);
            }
            
            // Check if the file was skipped (utility module)
            if (result === 'skipped') {
                console.log(StyleHelper.info(`Skipped utility module: ${relativePath}`, 'No executable code'));
                return null; // Don't update cache for skipped files
            }
            
            // Update cache after successful build
            if (result) {
                const buildTime = Date.now() - startTime;
                const currentHash = calculateHash(inputFile);
                const dependencies = this.cache[inputFile]?.dependencies || [];
                this.updateCache(inputFile, currentHash, dependencies);
                console.log(StyleHelper.built(relativePath, buildTime));
            }
            
            return result;
        } catch (error) {
            console.log(StyleHelper.error(`Failed to build ${relativePath}`, error instanceof Error ? error.message : String(error)));
            return null;
        }
    }

    private async incrementalBuild(inputFile: string, outputPath: string): Promise<string> {
        const context = this.esbuildContext.get(inputFile)!;
        const result = await context.rebuild();

        if (result.metafile) {
            this.updateDependencies(inputFile, result.metafile);
        }

        // Process and clean the output for incremental builds
        const content = await readFile(outputPath, 'utf8');
        const processedResult = await this.processNodeRedOutput(content);
        
        // Check if this is a utility module that should be skipped
        if (processedResult === null) {
            // Remove the output file if it exists
            await removeOutputFile(outputPath);
            return 'skipped';
        }
        
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, processedResult, 'utf8');

        // Success message handled in buildFile method
        return outputPath;
    }

    private async createAndBuild(inputFile: string, outputPath: string): Promise<string | null> {
        try {
            const context = await esbuild.context({
                entryPoints: [inputFile],
                outfile: outputPath,
                bundle: true,
                format: "iife",
                globalName: "nodeRedFunction",
                platform: "node",
                footer: { js: RETURN_MSG },
                minify: false,
                metafile: true,
                target: "es2022",
                write: false
            });

            this.esbuildContext.set(inputFile, context);
            const result = await context.rebuild();

            if (result.metafile) {
                this.updateDependencies(inputFile, result.metafile);
            }

            // Process and clean the output
            if (result.outputFiles && result.outputFiles.length > 0) {
                const processedResult = await this.processNodeRedOutput(result.outputFiles[0].text);
                
                // Check if this is a utility module that should be skipped
                if (processedResult === null) {
                    // Remove the output file if it exists
                    await removeOutputFile(outputPath);
                    return 'skipped';
                }
                
                await mkdir(dirname(outputPath), { recursive: true });
                await writeFile(outputPath, processedResult, 'utf8');
            }

            // Success message handled in buildFile method
            return outputPath;
        } catch (error) {
            // Fallback to regular build
            return await this.fallbackBuild(inputFile, outputPath);
        }
    }

    private async fallbackBuild(inputFile: string, outputPath: string): Promise<string> {
        const buildResult = await esbuild.build({
            entryPoints: [inputFile],
            outfile: outputPath,
            bundle: true,
            format: "iife",
            globalName: "nodeRedFunction",
            platform: "node",
            footer: { js: RETURN_MSG },
            minify: false,
            metafile: true,
            target: "es2022",
            write: false
        });

        // Process metafile
        if (buildResult.metafile) {
            this.updateDependencies(inputFile, buildResult.metafile);
        }

        // Process and clean the output
        if (buildResult.outputFiles && buildResult.outputFiles.length > 0) {
            const processedResult = await this.processNodeRedOutput(buildResult.outputFiles[0].text);
            
            // Check if this is a utility module that should be skipped
            if (processedResult === null) {
                // Remove the output file if it exists
                await removeOutputFile(outputPath);
                return 'skipped';
            }
            
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, processedResult, 'utf8');
        }

        console.log(chalk.green(`Successfully built ${inputFile} (fallback method)`));
        return outputPath;
    }


    private updateDependencies(inputFile: string, metafile: esbuild.Metafile): void {
        const dependencies = extractDependencies(metafile, inputFile, debug);

        if (this.cache[inputFile]) {
            this.cache[inputFile].dependencies = dependencies;
        }

        // Update dependency graph
        for (const dependency of dependencies) {
            this.dependencyGraph.addDependency(inputFile, dependency, debug);
        }
    }

    async buildFiles(changedFile?: string): Promise<Map<string, string>> {
        const startTime = Date.now();
        
        if (!changedFile) {
            await this.initialize();
        }

        if (emptyOutDir && !changedFile) {
            console.log(StyleHelper.cacheOperation("Cleaning output directory"));
            await this.cleanOutputDirectory();
        }

        const filesToBuild = await this.getFilesToBuild(changedFile);

        if (filesToBuild.length === 0) {
            console.log(StyleHelper.info("No files need rebuilding", "All files are up to date"));
            return new Map();
        }

        console.log(StyleHelper.section("Building Files"));
        console.log(StyleHelper.info(`Found ${filesToBuild.length} file(s) to build`));

        const builtFiles = new Map<string, string>();
        let successCount = 0;
        let failCount = 0;

        for (const file of filesToBuild) {
            const outputPath = await this.buildFile(file);
            if (outputPath) {
                const relativePath = getRelativePath(file, this.inputDir);
                builtFiles.set(relativePath, outputPath);
                successCount++;
            } else {
                failCount++;
            }
        }

        await saveCache(this.cache, debug);
        
        const buildTime = Date.now() - startTime;
        
        // Show summary
        console.log(StyleHelper.summary({
            total: filesToBuild.length,
            built: successCount,
            failed: failCount > 0 ? failCount : undefined,
            time: buildTime
        }));

        if (debug) {
            console.log(StyleHelper.section("Dependency Graph"));
            this.dependencyGraph.printGraph();
        }

        return builtFiles;
    }

    private async cleanOutputDirectory(): Promise<void> {
        try {
            await emptyDirectory(this.outputDir);
            this.cache = {};
            this.dependencyGraph.clear();
            await this.disposeContexts();
        } catch (error) {
            console.log(StyleHelper.error("Failed to empty output directory", error instanceof Error ? error.message : String(error)));
        }
    }

    private async getFilesToBuild(changedFile?: string): Promise<string[]> {
        if (changedFile) {
            const affectedFiles = this.dependencyGraph.getAffectedFiles(changedFile, debug);
            const files = [changedFile, ...affectedFiles];
            
            const relativePath = getRelativePath(changedFile, this.inputDir);
            console.log(StyleHelper.fileChanged(relativePath, 'changed'));
            if (files.length > 1) {
                console.log(StyleHelper.info(`Rebuilding ${files.length} affected files`));
            }
            
            return files;
        }

        // Full build - check all files
        const allFiles = await getFiles(this.inputDir, recursive, debug);
        return allFiles.filter(file => this.needsRebuild(file));
    }

    async startWatching(): Promise<void> {
        const watcher = chokidar.watch(this.inputDir, {
            ignored: DEFAULT_BLACKLIST,
            persistent: true,
            ignoreInitial: true
        });

        watcher
            .on("change", async (path) => {
                if (path.endsWith(".ts")) {
                    await this.buildFiles(path);
                }
            })
            .on("add", async (path) => {
                if (path.endsWith(".ts")) {
                    const relativePath = getRelativePath(path, this.inputDir);
                    console.log(StyleHelper.fileChanged(relativePath, 'added'));
                    await this.buildFiles(path);
                }
            })
            .on("unlink", async (path) => {
                if (path.endsWith(".ts")) {
                    const relativePath = getRelativePath(path, this.inputDir);
                    console.log(StyleHelper.fileChanged(relativePath, 'removed'));
                }
                await this.handleFileDeleted(path);
            })
            .on("error", (error) => {
                console.log(StyleHelper.error("Watcher error", error instanceof Error ? error.message : String(error)));
            });

        // Periodically clean up stale cache entries
        setInterval(() => this.cleanupStaleCache(), this.cacheTime);
    }

    private async handleFileDeleted(path: string): Promise<void> {
        if (!this.cache[path]) return;

        delete this.cache[path];
        await this.disposeContext(path);

        // Rebuild affected files
        const affectedFiles = this.dependencyGraph.getAffectedFiles(path, debug);
        
        if (affectedFiles.length > 0) {
            console.log(chalk.yellow(
                `File ${path} was deleted, rebuilding ${affectedFiles.length} affected files`
            ));

            for (const file of affectedFiles) {
                await this.buildFile(file);
            }
        }

        await saveCache(this.cache, debug);
        const relativePath = getRelativePath(path, this.inputDir);
        console.log(StyleHelper.cacheOperation("Removed cache entry", `deleted file: ${relativePath}`));

        // Remove output file
        const outputPath = getOutputPath(path, this.inputDir, this.outputDir);
        await removeOutputFile(outputPath);
    }

    async cleanupStaleCache(): Promise<void> {
        const currentTime = Date.now();
        let hasChanges = false;

        for (const [filePath, entry] of Object.entries(this.cache)) {
            if (currentTime - entry.lastChecked > this.cacheTime || !existsSync(filePath)) {
                delete this.cache[filePath];
                await this.disposeContext(filePath);
                hasChanges = true;
                this.logDebug(`Removed stale cache entry for: ${filePath}`);
            }
        }

        if (hasChanges) {
            await saveCache(this.cache, debug);
            console.log(StyleHelper.cacheOperation("Cleaned up stale cache entries"));
        }
    }

    private async disposeContext(filePath: string): Promise<void> {
        const context = this.esbuildContext.get(filePath);
        if (context) {
            await context.dispose();
            this.esbuildContext.delete(filePath);
        }
    }

    private async disposeContexts(): Promise<void> {
        for (const [_, context] of this.esbuildContext) {
            await context.dispose();
        }
        this.esbuildContext.clear();
    }

    async dispose(): Promise<void> {
        await this.disposeContexts();
    }

    private logDebug(message: string): void {
        if (debug) {
            console.log(chalk.gray(message));
        }
    }

    /**
     * Processes esbuild output for Node-RED compatibility.
     *
     * Cleanup operations:
     * 1. Strip IIFE wrapper: var nodeRedFunction = (() => {...})();
     * 2. Remove CommonJS artifacts: module.exports, exports.*, __defProp, __toCommonJS
     * 3. Remove Object.defineProperty calls for exports
     * 4. Remove 'use strict' declarations
     * 5. Trim empty lines
     * 6. Detect utility modules (only exports, no executable code)
     * 7. Ensure "return msg;" footer
     *
     * Utility module detection:
     * - Files with <10 characters after cleanup are considered utility modules
     * - Returns null to signal these should be skipped (no output file)
     * - Prevents deploying shared utilities as Node-RED functions
     *
     * @param code - Raw esbuild output with IIFE wrapper
     * @returns Cleaned code ready for Node-RED, or null if utility module
     *
     * @private
     *
     * @example
     * const raw = "var nodeRedFunction = (() => { console.log('test'); return msg; })();";
     * const processed = await processNodeRedOutput(raw);
     * // Returns: "console.log('test');\n\nreturn msg;"
     */
    private async processNodeRedOutput(code: string): Promise<string | null> {
        // First, check if we have an IIFE wrapped output
        const iifeMatch = code.match(/^var\s+\w+\s*=\s*\(\(\)\s*=>\s*{([\s\S]*)}\)\(\);?\s*$/m);
        
        let processed: string;
        if (iifeMatch) {
            // Extract the content inside the IIFE
            processed = iifeMatch[1];
        } else {
            // Try alternative IIFE patterns
            processed = code
                .replace(/^\s*\(\(\)\s*=>\s*{\s*/, '')
                .replace(/\s*}\)\(\);?\s*$/, '')
                .replace(/^\s*\(function\s*\(\)\s*{\s*/, '')
                .replace(/\s*}\)\(\);?\s*$/, '');
        }
        
        // Remove any module.exports or exports statements
        processed = processed.replace(/module\.exports\s*=\s*[^;]+;/g, '');
        processed = processed.replace(/exports\.[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*[^;]+;/g, '');
        
        // Clean up any remaining CommonJS artifacts
        processed = processed.replace(/var __defProp[\s\S]*?__toCommonJS\([^)]+\);/g, '');
        processed = processed.replace(/Object\.defineProperty\(exports,[\s\S]*?\);/g, '');
        
        // Remove any 'use strict' declarations
        processed = processed.replace(/^\s*["']use strict["'];?\s*\n?/gm, '');
        
        // Clean up empty lines at the beginning and end
        processed = processed.trim();
        
        // Check if the processed code is empty or only contains minimal content
        // This happens when a file is a pure utility module (only exports, no executable code)
        if (!processed || processed.length < 10) {
            // Return null to indicate this file should be skipped
            return null;
        }
        
        // Ensure proper ending
        if (!processed.endsWith('return msg;')) {
            processed += '\n\nreturn msg;';
        }
        
        return processed;
    }
}

/**
 * Deploys built files to Node-RED if requested via CLI flags.
 *
 * Deployment logic:
 * - Skipped if: no --deploy flag, watch mode active, no files built
 * - Uses Deployer class to update Node-RED function nodes
 * - Supports --dry-run mode for previewing changes
 * - Creates automatic backups before deployment (unless DEPLOY_BACKUP=false)
 *
 * Only deploys files that were actually built in this run (not cached files).
 * Matches TypeScript files to Node-RED function nodes via node-mappings.json.
 *
 * @param builtFiles - Map of relative paths to output files that were compiled
 *
 * @example
 * const builtFiles = new Map([['presence/presence.ts', 'dist/presence/presence.js']]);
 * await deployIfRequested(builtFiles);
 * // Deploys presence.ts to its mapped Node-RED function node
 */
async function deployIfRequested(builtFiles: Map<string, string>): Promise<void> {
    if (!(deploy || dryRun) || watch) return;

    if (builtFiles.size === 0) {
        console.log(StyleHelper.info("No files were built, nothing to deploy"));
        return;
    }

    console.log(StyleHelper.section("Deployment"));
    console.log(StyleHelper.info(`Deploying ${builtFiles.size} built file(s)...`));
    const deployer = new Deployer();
    
    // Only deploy the files that were actually built
    const tsFiles = Array.from(builtFiles.keys()).map(f => join(inputDir, f));
    const result = await deployer.deploy(tsFiles, { 
        backup: process.env.DEPLOY_BACKUP !== 'false', 
        dryRun 
    });
    
    if (result.success) {
        if (result.deployed.length > 0) {
            const deployedContent = result.deployed.map(deployment => {
                const [file, nodeName] = deployment.split(' \u2192 ');
                return `${StyleHelper.colors.success(StyleHelper.symbols.success)} ${StyleHelper.colors.bold(file)} \u2192 ${StyleHelper.colors.bold(nodeName)}`;
            });
            
            console.log(StyleHelper.panel(deployedContent, `${StyleHelper.colors.success('Auto-Deployed')} ${StyleHelper.colors.bold(result.deployed.length.toString())} Functions`));
        }
        if (result.failed.length > 0) {
            const failedContent = result.failed.map(f => 
                `${StyleHelper.colors.error(StyleHelper.symbols.error)} ${StyleHelper.colors.bold(f)}`
            );
            
            console.log(StyleHelper.panel(failedContent, `${StyleHelper.colors.error('Auto-Deploy Failed')} ${StyleHelper.colors.bold(result.failed.length.toString())} Functions`));
        }
    } else {
        console.error('\n' + StyleHelper.error(`Deployment failed: ${result.error}`));
        process.exit(1);
    }
}

/**
 * Main entry point for the build system.
 *
 * Execution flow:
 * 1. Print banner with system name and description
 * 2. --map mode: Generate function mappings and exit
 * 3. Normal mode: Build files with BuildManager
 * 4. Deploy if --deploy flag specified
 * 5. --watch mode: Start file watcher, else cleanup and exit
 *
 * Modes:
 * - Standard build: Compile changed files and their dependents
 * - Watch mode (-w): Continuous monitoring with auto-rebuild
 * - Mapping mode (--map): Generate node-mappings.json (optionally with --ai)
 * - Deploy mode (--deploy): Build + hot reload to Node-RED
 * - Dry-run mode (--dry-run): Preview deployment without changes
 *
 * Error handling:
 * - Catches all errors and displays styled error messages
 * - Shows stack traces in debug mode
 * - Exits with code 1 on fatal errors
 *
 * @example
 * // Standard build:
 * // tsx build/index.ts
 *
 * // Watch mode:
 * // tsx build/index.ts --watch
 *
 * // Build and deploy:
 * // tsx build/index.ts --deploy
 *
 * // Generate mappings with AI:
 * // tsx build/index.ts --map --ai
 */
async function main(): Promise<void> {
    const startTime = Date.now();
    
    // Print banner
    console.log(StyleHelper.banner('Node-RED TypeScript Builder', 'Compiling automation functions'));

    // Generate mappings if requested
    if (map) {
        console.log(StyleHelper.section("Function Mapping"));
        console.log(StyleHelper.info("Generating Node-RED function mappings..."));
        await generateMappingFile({ useAI: ai });
        return;
    }

    // Create and run build manager
    const buildManager = new BuildManager(inputDir, outputDir, cacheTime);
    const builtFiles = await buildManager.buildFiles();

    // Deploy if requested
    await deployIfRequested(builtFiles);

    // Start watching or cleanup
    if (watch) {
        if (deploy) {
            console.log(StyleHelper.warning("Deployment is disabled in watch mode"));
        }
        console.log(StyleHelper.watching(inputDir));
        await buildManager.startWatching();
    } else {
        const totalTime = Date.now() - startTime;
        console.log(StyleHelper.timing("Total build time", totalTime));
        await buildManager.dispose();
    }
}

// Run the main function
main().catch((error) => {
    console.log(StyleHelper.error("Fatal build error", error instanceof Error ? error.message : String(error)));
    if (debug && error instanceof Error && error.stack) {
        console.log(StyleHelper.colors.muted(error.stack));
    }
    process.exit(1);
});