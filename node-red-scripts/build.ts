import path from "path";
import fs from "fs/promises";
import { existsSync, writeFileSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import chalk from "chalk";
import chokidar from "chokidar";
import * as esbuild from "esbuild";
import crypto from "crypto";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { config as loadEnv } from "dotenv";
import { generateMappingFile } from "./src/deploy/mappings/mapper";
import { Deployer } from "./src/deploy/deploy";

// Load environment variables
loadEnv();

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RETURN_MSG = "\nreturn msg;";
const DEFAULT_BLACKLIST = ["node_modules", /\.d\.ts$/];
const CACHE_FILE = ".build-cache.json";
const CACHE_STALE_TIME = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Enhanced Cache Interface
interface CacheEntry {
    hash: string;
    lastChecked: number;
    dependencies: string[];
}

interface BuildCache {
    [filePath: string]: CacheEntry;
}

// CLI configuration
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

const { inputDir, outputDir, emptyOutDir, recursive, watch, cacheTime, debug, deploy, "dry-run": dryRun, map, ai } = argv;

// Dependency Graph
class DependencyGraph {
    private graph: Map<string, Set<string>> = new Map();
    private reverseGraph: Map<string, Set<string>> = new Map();

    addDependency(file: string, dependency: string): void {
        if (!this.graph.has(file)) {
            this.graph.set(file, new Set());
        }
        this.graph.get(file)!.add(dependency);

        if (!this.reverseGraph.has(dependency)) {
            this.reverseGraph.set(dependency, new Set());
        }
        this.reverseGraph.get(dependency)!.add(file);

        if (debug) {
            console.log(chalk.gray(`Added dependency: ${file} -> ${dependency}`));
        }
    }

    getDependencies(file: string): string[] {
        return this.graph.has(file) ? Array.from(this.graph.get(file)!) : [];
    }

    getAffectedFiles(file: string): string[] {
        const visited = new Set<string>();
        const result: string[] = [];

        const dfs = (currentFile: string) => {
            if (!this.reverseGraph.has(currentFile)) return;

            for (const dependent of this.reverseGraph.get(currentFile)!) {
                if (!visited.has(dependent)) {
                    visited.add(dependent);
                    result.push(dependent);
                    dfs(dependent);
                }
            }
        };

        dfs(file);

        if (debug && result.length > 0) {
            console.log(chalk.gray(`Files affected by change to ${file}:`));
            result.forEach((f) => console.log(chalk.gray(`  - ${f}`)));
        }

        return result;
    }

    clear(): void {
        this.graph.clear();
        this.reverseGraph.clear();
    }

    // Utility method to print the graph (for debugging)
    printGraph(): void {
        console.log(chalk.cyan("Dependency Graph:"));
        for (const [file, deps] of this.graph.entries()) {
            console.log(chalk.cyan(`${file} depends on:`));
            for (const dep of deps) {
                console.log(chalk.cyan(`  - ${dep}`));
            }
        }

        console.log(chalk.magenta("Reverse Dependency Graph:"));
        for (const [file, dependents] of this.reverseGraph.entries()) {
            console.log(chalk.magenta(`${file} is used by:`));
            for (const dep of dependents) {
                console.log(chalk.magenta(`  - ${dep}`));
            }
        }
    }
}

// Build Manager
class BuildManager {
    private cache: BuildCache = {};
    private dependencyGraph = new DependencyGraph();
    private esbuildContext: Map<string, esbuild.BuildContext> = new Map();

    constructor(
        private inputDir: string,
        private outputDir: string,
        private cacheTime: number
    ) {}

    async loadCache(): Promise<void> {
        try {
            if (existsSync(CACHE_FILE)) {
                const cacheData = readFileSync(CACHE_FILE, "utf8");
                this.cache = JSON.parse(cacheData);
                console.log(chalk.gray("Cache loaded"));

                // Rebuild dependency graph from cache
                for (const [filePath, entry] of Object.entries(this.cache)) {
                    if (entry.dependencies) {
                        for (const dependency of entry.dependencies) {
                            this.dependencyGraph.addDependency(filePath, dependency);
                        }
                    }
                }

                if (debug) {
                    console.log(chalk.gray("Dependency graph rebuilt from cache"));
                    this.dependencyGraph.printGraph();
                }
            }
        } catch (error) {
            console.warn(chalk.yellow("Failed to load cache file, starting fresh"));
            this.cache = {};
        }
    }

    async saveCache(): Promise<void> {
        try {
            writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
            if (debug) {
                console.log(chalk.gray("Cache saved to disk"));
            }
        } catch (error) {
            console.error(chalk.red("Failed to save cache file:"), error);
        }
    }

    private calculateHash(filePath: string): string {
        const content = readFileSync(filePath);
        return crypto.createHash("md5").update(content).digest("hex");
    }

    async needsRebuild(filePath: string): Promise<boolean> {
        const outputPath = path.join(
            this.outputDir,
            path.relative(this.inputDir, filePath).replace(/\.ts$/, ".js")
        );

        if (!existsSync(outputPath)) {
            if (debug) {
                console.log(
                    chalk.gray(`${filePath} needs rebuild: Output doesn't exist`)
                );
            }
            return true;
        }

        const currentTime = Date.now();
        const currentHash = this.calculateHash(filePath);
        const cacheEntry = this.cache[filePath];

        if (cacheEntry) {
            const isStale = currentTime - cacheEntry.lastChecked > this.cacheTime;
            const hasChanged = currentHash !== cacheEntry.hash;

            let dependencyChanged = false;
            if (!hasChanged && cacheEntry.dependencies) {
                for (const dependency of cacheEntry.dependencies) {
                    if (existsSync(dependency)) {
                        const depHash = this.calculateHash(dependency);
                        const depEntry = this.cache[dependency];
                        if (!depEntry || depHash !== depEntry.hash) {
                            dependencyChanged = true;
                            if (debug) {
                                console.log(
                                    chalk.gray(
                                        `${filePath} needs rebuild: Dependency ${dependency} changed`
                                    )
                                );
                            }
                            break;
                        }
                    } else {
                        dependencyChanged = true;
                        if (debug) {
                            console.log(
                                chalk.gray(
                                    `${filePath} needs rebuild: Dependency ${dependency} missing`
                                )
                            );
                        }
                        break;
                    }
                }
            }

            if (isStale) {
                if (debug) {
                    console.log(
                        chalk.gray(`${filePath} needs rebuild: Cache entry is stale`)
                    );
                }
            }

            if (hasChanged) {
                if (debug) {
                    console.log(
                        chalk.gray(`${filePath} needs rebuild: File content changed`)
                    );
                }
            }

            if (isStale || hasChanged || dependencyChanged) {
                this.cache[filePath] = {
                    hash: currentHash,
                    lastChecked: currentTime,
                    dependencies: cacheEntry.dependencies || []
                };
                return true;
            }

            if (debug) {
                console.log(
                    chalk.gray(`${filePath} doesn't need rebuild: No changes detected`)
                );
            }
            return false;
        }

        if (debug) {
            console.log(chalk.gray(`${filePath} needs rebuild: No cache entry`));
        }

        this.cache[filePath] = {
            hash: currentHash,
            lastChecked: currentTime,
            dependencies: []
        };
        return true;
    }

    async getFiles(dir: string, recursive: boolean): Promise<string[]> {
        const files: string[] = [];

        try {
            const list = await fs.readdir(dir);

            for (const file of list) {
                const filePath = path.resolve(dir, file);

                if (
                    DEFAULT_BLACKLIST.some((item) =>
                        item instanceof RegExp
                            ? item.test(filePath)
                            : filePath.includes(item)
                    )
                ) {
                    if (debug) {
                        console.log(
                            chalk.yellow(`Skipping blacklisted path: ${filePath}`)
                        );
                    }
                    continue;
                }

                const stat = await fs.stat(filePath);

                if (stat.isDirectory() && recursive) {
                    if (debug) {
                        console.log(chalk.blue(`Scanning directory: ${filePath}`));
                    }
                    files.push(...(await this.getFiles(filePath, recursive)));
                } else if (stat.isFile() && filePath.endsWith(".ts")) {
                    files.push(filePath);
                }
            }
        } catch (error) {
            console.error(chalk.red(`Error reading directory ${dir}:`), error);
        }

        return files;
    }

    // Extract dependencies from esbuild metafile
    private extractDependencies(
        metafile: esbuild.Metafile,
        inputFile: string
    ): string[] {
        const dependencies: string[] = [];

        if (metafile && metafile.inputs) {
            for (const [depPath, depInfo] of Object.entries(metafile.inputs)) {
                if (path.resolve(depPath) !== path.resolve(inputFile)) {
                    const resolvedPath = path.resolve(depPath);
                    dependencies.push(resolvedPath);

                    if (debug) {
                        console.log(
                            chalk.gray(
                                `Extracted dependency: ${inputFile} -> ${resolvedPath}`
                            )
                        );
                    }
                }
            }
        }

        return dependencies;
    }

    async buildFile(inputFile: string): Promise<string | null> {
        try {
            console.log(chalk.blue(`Building ${inputFile}...`));
            const name = path.relative(this.inputDir, inputFile).replace(/\.ts$/, "");

            // Check if we have an existing build context for incremental builds
            if (this.esbuildContext.has(inputFile)) {
                const context = this.esbuildContext.get(inputFile)!;
                const result = await context.rebuild();

                if (result.metafile) {
                    // Update dependencies in case they changed
                    const dependencies = this.extractDependencies(
                        result.metafile,
                        inputFile
                    );

                    if (this.cache[inputFile]) {
                        this.cache[inputFile].dependencies = dependencies;
                    }

                    // Update dependency graph
                    for (const dependency of dependencies) {
                        this.dependencyGraph.addDependency(inputFile, dependency);
                    }
                }

                console.log(chalk.green(`Successfully rebuilt ${inputFile}`));
                return path.join(this.outputDir, `${name}.js`);
            }

            // Create a new build context for first-time build
            try {
                const context = await esbuild.context({
                    entryPoints: [inputFile],
                    outfile: path.join(this.outputDir, `${name}.js`),
                    bundle: true,
                    format: "cjs",
                    platform: "node",
                    footer: { js: RETURN_MSG },
                    minify: false,
                    metafile: true,
                    target: "es2022"
                });

                // Store the context for future incremental builds
                this.esbuildContext.set(inputFile, context);

                // Perform the initial build
                const result = await context.rebuild();

                // Process dependencies
                if (result.metafile) {
                    const dependencies = this.extractDependencies(
                        result.metafile,
                        inputFile
                    );

                    if (this.cache[inputFile]) {
                        this.cache[inputFile].dependencies = dependencies;
                    }

                    // Update dependency graph
                    for (const dependency of dependencies) {
                        this.dependencyGraph.addDependency(inputFile, dependency);
                    }
                }

                console.log(chalk.green(`Successfully built ${inputFile}`));
                return path.join(this.outputDir, `${name}.js`);
            } catch (error) {
                console.error(chalk.red(`Failed to build ${inputFile}:`), error);

                // Fallback to non-incremental build if context creation fails
                await esbuild.build({
                    entryPoints: [inputFile],
                    outfile: path.join(this.outputDir, `${name}.js`),
                    bundle: true,
                    format: "cjs",
                    platform: "node",
                    footer: { js: RETURN_MSG },
                    minify: false,
                    metafile: true,
                    metafileOutputFile: path.join(this.outputDir, `${name}.meta.json`),
                    target: "es2022"
                });

                // Read metafile manually
                try {
                    const metafilePath = path.join(this.outputDir, `${name}.meta.json`);
                    if (existsSync(metafilePath)) {
                        const metafileContent = readFileSync(metafilePath, "utf8");
                        const metafile = JSON.parse(metafileContent);

                        const dependencies = this.extractDependencies(
                            metafile,
                            inputFile
                        );

                        if (this.cache[inputFile]) {
                            this.cache[inputFile].dependencies = dependencies;
                        }

                        // Update dependency graph
                        for (const dependency of dependencies) {
                            this.dependencyGraph.addDependency(inputFile, dependency);
                        }

                        // Clean up meta file
                        fs.unlink(metafilePath).catch(() => {});
                    }
                } catch (metaError) {
                    console.warn(
                        chalk.yellow(
                            `Failed to process metafile for ${inputFile}:`,
                            metaError
                        )
                    );
                }

                console.log(
                    chalk.green(`Successfully built ${inputFile} (fallback method)`)
                );
                return path.join(this.outputDir, `${name}.js`);
            }
        } catch (error) {
            console.error(chalk.red(`Failed to build ${inputFile}:`), error);
        }
        return null;
    }

    async buildFiles(changedFile?: string): Promise<Map<string, string>> {
        if (!changedFile) {
            await this.loadCache();
        }

        if (emptyOutDir && !changedFile) {
            try {
                console.log(
                    chalk.yellow(`Emptying output directory: ${this.outputDir}`)
                );
                await fs
                    .rm(this.outputDir, { recursive: true, force: true })
                    .catch(() => {});
                await fs.mkdir(this.outputDir, { recursive: true });
                this.cache = {};
                this.dependencyGraph.clear();

                // Dispose all existing contexts
                for (const [filePath, context] of this.esbuildContext.entries()) {
                    await context.dispose();
                }
                this.esbuildContext.clear();
            } catch (error) {
                console.error(chalk.red("Failed to empty output directory:"), error);
            }
        }

        let filesToBuild: string[] = [];

        if (changedFile) {
            // Get all files that depend on the changed file (directly or indirectly)
            const affectedFiles = this.dependencyGraph.getAffectedFiles(changedFile);

            // Add the changed file itself to the build list
            filesToBuild = [changedFile, ...affectedFiles];

            console.log(
                chalk.blue(
                    `File changed: ${changedFile}, rebuilding ${filesToBuild.length} affected files`
                )
            );
        } else {
            // For full builds, check all files
            const allFiles = await this.getFiles(this.inputDir, recursive);
            filesToBuild = [];

            // Check each file if it needs rebuilding
            for (const file of allFiles) {
                if (await this.needsRebuild(file)) {
                    filesToBuild.push(file);
                }
            }
        }

        if (filesToBuild.length === 0) {
            console.log(chalk.gray("No files need rebuilding"));
            return new Map();
        }

        console.log(chalk.blue(`Building ${filesToBuild.length} files...`));

        // Track built files for deployment
        const builtFiles = new Map<string, string>();

        // Process files sequentially to avoid race conditions
        for (const file of filesToBuild) {
            const outputPath = await this.buildFile(file);
            if (outputPath) {
                const relativePath = path.relative(this.inputDir, file);
                builtFiles.set(relativePath, outputPath);
            }
        }

        // Save the updated cache
        await this.saveCache();

        if (debug) {
            console.log(chalk.cyan("Final dependency graph:"));
            this.dependencyGraph.printGraph();
        }

        return builtFiles;
    }

    async cleanupStaleCache(): Promise<void> {
        const currentTime = Date.now();
        let hasChanges = false;

        for (const [filePath, entry] of Object.entries(this.cache)) {
            if (
                currentTime - entry.lastChecked > this.cacheTime ||
                !existsSync(filePath)
            ) {
                delete this.cache[filePath];

                if (this.esbuildContext.has(filePath)) {
                    const context = this.esbuildContext.get(filePath)!;
                    await context.dispose();
                    this.esbuildContext.delete(filePath);
                }

                hasChanges = true;

                if (debug) {
                    console.log(
                        chalk.gray(`Removed stale cache entry for: ${filePath}`)
                    );
                }
            }
        }

        if (hasChanges) {
            await this.saveCache();
            console.log(chalk.gray("Cleaned up stale cache entries"));
        }
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
                if (this.cache[path]) {
                    delete this.cache[path];

                    if (this.esbuildContext.has(path)) {
                        const context = this.esbuildContext.get(path)!;
                        await context.dispose();
                        this.esbuildContext.delete(path);
                    }

                    // Get affected files before removing from dependency graph
                    const affectedFiles = this.dependencyGraph.getAffectedFiles(path);

                    // If any files depend on this one, rebuild them
                    if (affectedFiles.length > 0) {
                        console.log(
                            chalk.yellow(
                                `File ${path} was deleted, rebuilding ${affectedFiles.length} affected files`
                            )
                        );

                        // Build each affected file
                        for (const affectedFile of affectedFiles) {
                            await this.buildFile(affectedFile);
                        }
                    }

                    await this.saveCache();

                    console.log(
                        chalk.yellow(`Removed cache entry for deleted file: ${path}`)
                    );

                    // Try to remove the output file
                    const outputPath = path.join(
                        this.outputDir,
                        path.relative(this.inputDir, path).replace(/\.ts$/, ".js")
                    );

                    if (existsSync(outputPath)) {
                        await fs.unlink(outputPath).catch(() => {});
                        console.log(chalk.yellow(`Removed output file: ${outputPath}`));
                    }
                }
            })
            .on("error", (error) => {
                console.error(chalk.red("Watcher error:"), error);
            });

        console.log(chalk.cyan(`Watching for changes in ${this.inputDir}...`));

        // Periodically clean up stale cache entries in watch mode
        setInterval(() => this.cleanupStaleCache(), this.cacheTime);
    }

    async dispose(): Promise<void> {
        // Dispose of all build contexts
        for (const [filePath, context] of this.esbuildContext.entries()) {
            await context.dispose();
        }

        // Clear the context map
        this.esbuildContext.clear();
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

    // Create build manager
    const buildManager = new BuildManager(inputDir, outputDir, cacheTime);

    // Initial build
    const builtFiles = await buildManager.buildFiles();

    // Deploy if requested and not in watch mode
    if ((deploy || dryRun) && !watch) {
        if (builtFiles.size === 0) {
            console.log(chalk.yellow("No files were built, nothing to deploy"));
        } else {
            console.log(chalk.cyan("\nChecking for deployment..."));
            const deployer = new Deployer();
            
            // Only deploy the files that were actually built (changed)
            const tsFiles = Array.from(builtFiles.keys()).map(f => path.join(inputDir, f));
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
    }

    // Watch mode
    if (watch) {
        if (deploy) {
            console.log(chalk.yellow("\nNote: Deployment is disabled in watch mode"));
        }
        await buildManager.startWatching();
    } else {
        // Dispose of resources if not in watch mode
        await buildManager.dispose();
    }
}

// Run the main function
main().catch((error) => {
    console.error(chalk.red("Fatal error:"), error);
    process.exit(1);
});
