import { build, defineConfig } from "vite";
import { resolve } from "path";
import fs from "fs";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";
import chokidar from "chokidar";
import url from "url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const RETURN_MSG = "\nreturn msg;";

const DEFAULT_BLACKLIST = ["node_modules", /\.d\.ts$/];

const CACHE_FILE = ".build-cache.json";

const CACHE_STALE_TIME = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Cache interface
interface CacheEntry {
    mtimeMs: number;
    lastChecked: number;
}

interface BuildCache {
    [filePath: string]: CacheEntry;
}

// Load or initialize the cache
function loadCache(): BuildCache {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const cacheData = fs.readFileSync(CACHE_FILE, "utf8");
            return JSON.parse(cacheData);
        }
    } catch (error) {
        console.warn(chalk.yellow("Failed to load cache file, starting fresh"));
    }
    return {};
}

// Save cache to disk
function saveCache(cache: BuildCache): void {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (error) {
        console.error(chalk.red("Failed to save cache file:"), error);
    }
}

// Cache management
let fileCache: BuildCache = loadCache();

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
    .help()
    .alias("help", "h")
    .parseSync();

const { inputDir, outputDir, emptyOutDir, recursive, watch, cacheTime } = argv;

// Check if a file needs rebuilding
function needsRebuild(filePath: string): boolean {
    const outputPath = path.join(
        outputDir,
        path.relative(inputDir, filePath).replace(/\.ts$/, ".js")
    );

    // Always rebuild if output doesn't exist
    if (!fs.existsSync(outputPath)) {
        return true;
    }

    const currentTime = Date.now();
    const inputStat = fs.statSync(filePath);
    const cacheEntry = fileCache[filePath];

    // Check if cache entry exists and is still valid
    if (cacheEntry) {
        const isStale = currentTime - cacheEntry.lastChecked > cacheTime;
        const hasChanged = inputStat.mtimeMs > cacheEntry.mtimeMs;

        if (isStale || hasChanged) {
            // Update cache entry
            fileCache[filePath] = {
                mtimeMs: inputStat.mtimeMs,
                lastChecked: currentTime
            };
            saveCache(fileCache);
            return true;
        }
        return false;
    }

    // No cache entry exists, create one and rebuild
    fileCache[filePath] = {
        mtimeMs: inputStat.mtimeMs,
        lastChecked: currentTime
    };
    saveCache(fileCache);
    return true;
}

// Get all TypeScript files in directory
function getFiles(dir: string, recursive: boolean): string[] {
    const files: string[] = [];

    try {
        const list = fs.readdirSync(dir);

        for (const file of list) {
            const filePath = path.resolve(dir, file);

            if (
                DEFAULT_BLACKLIST.some((item) =>
                    item instanceof RegExp
                        ? item.test(filePath)
                        : filePath.includes(item)
                )
            ) {
                console.log(chalk.yellow(`Skipping blacklisted path: ${filePath}`));
                continue;
            }

            const stat = fs.statSync(filePath);

            if (stat.isDirectory() && recursive) {
                console.log(chalk.blue(`Scanning directory: ${filePath}`));
                files.push(...getFiles(filePath, recursive));
            } else if (stat.isFile() && filePath.endsWith(".ts")) {
                files.push(filePath);
            }
        }
    } catch (error) {
        console.error(chalk.red(`Error reading directory ${dir}:`), error);
    }

    return files;
}

// Create Vite config for a single file
function createViteConfig(inputFile: string): ReturnType<typeof defineConfig> {
    const name = path.relative(inputDir, inputFile).replace(/\.ts$/, "");

    return defineConfig({
        build: {
            minify: false,
            outDir: outputDir,
            emptyOutDir: false,
            rollupOptions: {
                input: {
                    [name]: resolve(__dirname, inputFile)
                },
                output: {
                    esModule: false,
                    dir: outputDir,
                    entryFileNames: "[name].js",
                    format: "cjs",
                    footer: RETURN_MSG
                }
            }
        }
    });
}

// Build a single file
async function buildFile(inputFile: string): Promise<void> {
    try {
        console.log(chalk.blue(`Building ${inputFile}...`));
        const config = createViteConfig(inputFile);

        // @ts-ignore
        await build(config);

        console.log(chalk.green(`Successfully built ${inputFile}`));
    } catch (error) {
        console.error(chalk.red(`Failed to build ${inputFile}:`), error);
    }
}

// Main build function
async function buildFiles(changedFile?: string) {
    if (emptyOutDir && !changedFile) {
        try {
            console.log(chalk.yellow(`Emptying output directory: ${outputDir}`));
            await fs.promises.rm(outputDir, { recursive: true, force: true });
            // Clear cache when emptying output directory
            fileCache = {};
            saveCache(fileCache);
        } catch (error) {
            console.error(chalk.red("Failed to empty output directory:"), error);
        }
    }

    const files = changedFile ? [changedFile] : getFiles(inputDir, recursive);
    const filesToBuild = files.filter(needsRebuild);

    if (filesToBuild.length === 0) {
        console.log(chalk.gray("No files need rebuilding"));
        return;
    }

    console.log(chalk.blue(`Building ${filesToBuild.length} files...`));
    await Promise.all(filesToBuild.map(buildFile));
    saveCache(fileCache);
}

// Cleanup function for cache maintenance
function cleanupStaleCache(): void {
    const currentTime = Date.now();
    let hasChanges = false;

    for (const [filePath, entry] of Object.entries(fileCache)) {
        if (currentTime - entry.lastChecked > cacheTime || !fs.existsSync(filePath)) {
            delete fileCache[filePath];
            hasChanges = true;
        }
    }

    if (hasChanges) {
        saveCache(fileCache);
        console.log(chalk.gray("Cleaned up stale cache entries"));
    }
}

// Initial cache cleanup and build
cleanupStaleCache();
buildFiles();

// Watch mode
if (watch) {
    const watcher = chokidar.watch(inputDir, {
        ignored: DEFAULT_BLACKLIST,
        persistent: true
    });

    watcher
        .on("change", async (path) => {
            console.log(chalk.blue(`File changed: ${path}`));
            if (path.endsWith(".ts")) {
                await buildFiles(path);
            }
        })
        .on("unlink", (path) => {
            // Remove cache entry when file is deleted
            if (fileCache[path]) {
                delete fileCache[path];
                saveCache(fileCache);

                console.log(
                    chalk.yellow(`Removed cache entry for deleted file: ${path}`)
                );
            }
        })
        .on("error", (error) => {
            console.error(chalk.red("Watcher error:"), error);
        });

    console.log(chalk.cyan(`Watching for changes in ${inputDir}...`));

    // Periodically clean up stale cache entries in watch mode
    setInterval(cleanupStaleCache, cacheTime);
}
