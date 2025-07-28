import { existsSync } from "fs";
import { join, dirname } from "path";
import { writeFile, readFile, mkdir } from "fs/promises";
import chalk from "chalk";
import chokidar from "chokidar";
import * as esbuild from "esbuild";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { config as loadEnv } from "dotenv";
import { generateMappingFile } from "../src/deploy/mappings/mapper";
import { Deployer } from "../src/deploy/deploy";
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

// Load environment variables
loadEnv();

// Parse command line arguments
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

// Build Manager class - handles the build process
class BuildManager {
    private cache: BuildCache = {};
    private dependencyGraph = new DependencyGraph();
    private esbuildContext: Map<string, esbuild.BuildContext> = new Map();

    constructor(
        private inputDir: string,
        private outputDir: string,
        private cacheTime: number
    ) {}

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
            this.updateCache(filePath, currentHash, []);
            return true;
        }

        const reasons = this.checkRebuildReasons(filePath, cacheEntry, currentHash);
        
        if (reasons.length > 0) {
            reasons.forEach(reason => this.logDebug(`${filePath} needs rebuild: ${reason}`));
            this.updateCache(filePath, currentHash, cacheEntry.dependencies);
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

    async buildFile(inputFile: string): Promise<string | null> {
        try {
            console.log(chalk.blue(`Building ${inputFile}...`));
            const name = getRelativePath(inputFile, this.inputDir).replace(/\.ts$/, "");
            const outputPath = join(this.outputDir, `${name}.js`);

            // Try incremental build first
            if (this.esbuildContext.has(inputFile)) {
                return await this.incrementalBuild(inputFile, outputPath);
            }

            // Create new build context
            return await this.createAndBuild(inputFile, outputPath);
        } catch (error) {
            console.error(chalk.red(`Failed to build ${inputFile}:`), error);
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
        const processedCode = await this.processNodeRedOutput(content);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, processedCode, 'utf8');

        console.log(chalk.green(`Successfully rebuilt ${inputFile}`));
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
                const processedCode = await this.processNodeRedOutput(result.outputFiles[0].text);
                await mkdir(dirname(outputPath), { recursive: true });
                await writeFile(outputPath, processedCode, 'utf8');
            }

            console.log(chalk.green(`Successfully built ${inputFile}`));
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
            const processedCode = await this.processNodeRedOutput(buildResult.outputFiles[0].text);
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, processedCode, 'utf8');
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
        if (!changedFile) {
            await this.initialize();
        }

        if (emptyOutDir && !changedFile) {
            await this.cleanOutputDirectory();
        }

        const filesToBuild = await this.getFilesToBuild(changedFile);

        if (filesToBuild.length === 0) {
            console.log(chalk.gray("No files need rebuilding"));
            return new Map();
        }

        console.log(chalk.blue(`Building ${filesToBuild.length} files...`));

        const builtFiles = new Map<string, string>();

        for (const file of filesToBuild) {
            const outputPath = await this.buildFile(file);
            if (outputPath) {
                const relativePath = getRelativePath(file, this.inputDir);
                builtFiles.set(relativePath, outputPath);
            }
        }

        await saveCache(this.cache, debug);

        if (debug) {
            console.log(chalk.cyan("Final dependency graph:"));
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
            console.error(chalk.red("Failed to empty output directory:"), error);
        }
    }

    private async getFilesToBuild(changedFile?: string): Promise<string[]> {
        if (changedFile) {
            const affectedFiles = this.dependencyGraph.getAffectedFiles(changedFile, debug);
            const files = [changedFile, ...affectedFiles];
            
            console.log(chalk.blue(
                `File changed: ${changedFile}, rebuilding ${files.length} affected files`
            ));
            
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
                    console.log(chalk.blue(`New file detected: ${path}`));
                    await this.buildFiles(path);
                }
            })
            .on("unlink", async (path) => {
                await this.handleFileDeleted(path);
            })
            .on("error", (error) => {
                console.error(chalk.red("Watcher error:"), error);
            });

        console.log(chalk.cyan(`Watching for changes in ${this.inputDir}...`));

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
        console.log(chalk.yellow(`Removed cache entry for deleted file: ${path}`));

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
            console.log(chalk.gray("Cleaned up stale cache entries"));
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

    private async processNodeRedOutput(code: string): Promise<string> {
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
        
        // Ensure proper ending
        if (!processed.endsWith('return msg;')) {
            processed += '\n\nreturn msg;';
        }
        
        return processed;
    }
}

// Deploy built files to Node-RED
async function deployIfRequested(builtFiles: Map<string, string>): Promise<void> {
    if (!(deploy || dryRun) || watch) return;

    if (builtFiles.size === 0) {
        console.log(chalk.yellow("No files were built, nothing to deploy"));
        return;
    }

    console.log(chalk.cyan("\nChecking for deployment..."));
    const deployer = new Deployer();
    
    // Only deploy the files that were actually built
    const tsFiles = Array.from(builtFiles.keys()).map(f => join(inputDir, f));
    const result = await deployer.deploy(tsFiles, { 
        backup: process.env.DEPLOY_BACKUP !== 'false', 
        dryRun 
    });
    
    if (result.success) {
        if (result.deployed.length > 0) {
            console.log(chalk.green(`\n✓ Deployment successful`));
            console.log(chalk.green(`  Deployed: ${result.deployed.length} functions`));
            result.deployed.forEach(d => console.log(chalk.gray(`    - ${d}`)));
        }
        if (result.failed.length > 0) {
            console.log(chalk.yellow(`  Failed: ${result.failed.length} functions`));
            result.failed.forEach(f => console.log(chalk.gray(`    - ${f}`)));
        }
    } else {
        console.error(chalk.red(`\n✗ Deployment failed: ${result.error}`));
        process.exit(1);
    }
}

// Main function
async function main(): Promise<void> {
    // Generate mappings if requested
    if (map) {
        console.log(chalk.cyan("Generating Node-RED function mappings..."));
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
            console.log(chalk.yellow("\nNote: Deployment is disabled in watch mode"));
        }
        await buildManager.startWatching();
    } else {
        await buildManager.dispose();
    }
}

// Run the main function
main().catch((error) => {
    console.error(chalk.red("Fatal error:"), error);
    process.exit(1);
});