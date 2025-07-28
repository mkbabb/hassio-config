import { existsSync, readFileSync, writeFileSync } from "fs";
import { readdir, stat, unlink, readFile, writeFile, rm, mkdir } from "fs/promises";
import { resolve, relative, join, basename } from "path";
import crypto from "crypto";
import chalk from "chalk";
import * as esbuild from "esbuild";

// Constants
export const RETURN_MSG = "\nreturn msg;";
export const DEFAULT_BLACKLIST = ["node_modules", /\.d\.ts$/, "src/deploy"];
export const CACHE_FILE = ".build-cache.json";
export const CACHE_STALE_TIME = 24 * 60 * 60 * 1000; // 24 hours

// Cache types
export interface CacheEntry {
    hash: string;
    lastChecked: number;
    dependencies: string[];
}

export interface BuildCache {
    [filePath: string]: CacheEntry;
}

// File operations
export async function getFiles(dir: string, recursive: boolean, debug: boolean): Promise<string[]> {
    const files: string[] = [];

    try {
        const list = await readdir(dir);

        for (const file of list) {
            const filePath = resolve(dir, file);

            if (shouldSkipPath(filePath, debug)) {
                continue;
            }

            const fileStat = await stat(filePath);

            if (fileStat.isDirectory() && recursive) {
                if (debug) {
                    console.log(chalk.blue(`Scanning directory: ${filePath}`));
                }
                files.push(...(await getFiles(filePath, recursive, debug)));
            } else if (fileStat.isFile() && filePath.endsWith(".ts")) {
                files.push(filePath);
            }
        }
    } catch (error) {
        console.error(chalk.red(`Error reading directory ${dir}:`), error);
    }

    return files;
}

function shouldSkipPath(filePath: string, debug: boolean): boolean {
    const shouldSkip = DEFAULT_BLACKLIST.some((item) =>
        item instanceof RegExp ? item.test(filePath) : filePath.includes(item)
    );

    if (shouldSkip && debug) {
        console.log(chalk.yellow(`Skipping blacklisted path: ${filePath}`));
    }

    return shouldSkip;
}

export async function removeOutputFile(outputPath: string): Promise<void> {
    if (existsSync(outputPath)) {
        await unlink(outputPath).catch(() => {});
        console.log(chalk.yellow(`Removed output file: ${outputPath}`));
    }
}

export async function emptyDirectory(dir: string): Promise<void> {
    console.log(chalk.yellow(`Emptying output directory: ${dir}`));
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await mkdir(dir, { recursive: true });
}

// Cache operations
export function calculateHash(filePath: string): string {
    const content = readFileSync(filePath);
    return crypto.createHash("md5").update(content).digest("hex");
}

export async function loadCache(debug: boolean): Promise<BuildCache> {
    try {
        if (existsSync(CACHE_FILE)) {
            const cacheData = readFileSync(CACHE_FILE, "utf8");
            console.log(chalk.gray("Cache loaded"));
            return JSON.parse(cacheData);
        }
    } catch (error) {
        console.warn(chalk.yellow("Failed to load cache file, starting fresh"));
    }
    return {};
}

export async function saveCache(cache: BuildCache, debug: boolean): Promise<void> {
    try {
        writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
        if (debug) {
            console.log(chalk.gray("Cache saved to disk"));
        }
    } catch (error) {
        console.error(chalk.red("Failed to save cache file:"), error);
    }
}

// ESBuild helpers
export function extractDependencies(metafile: esbuild.Metafile, inputFile: string, debug: boolean): string[] {
    const dependencies: string[] = [];

    if (metafile?.inputs) {
        for (const depPath of Object.keys(metafile.inputs)) {
            if (resolve(depPath) !== resolve(inputFile)) {
                const resolvedPath = resolve(depPath);
                dependencies.push(resolvedPath);

                if (debug) {
                    console.log(chalk.gray(`Extracted dependency: ${inputFile} -> ${resolvedPath}`));
                }
            }
        }
    }

    return dependencies;
}

export async function stripCommonJSWrapper(filePath: string, debug: boolean): Promise<void> {
    try {
        let content = await readFile(filePath, 'utf8');
        
        // Remove CommonJS wrapper patterns
        const patterns = [
            /var __defProp[\s\S]*?module\.exports\s*=\s*__toCommonJS\([^)]+\);[\r\n]*/g,
            /module\.exports\s*=\s*[^;]+;[\r\n]*/g,
            /exports\.[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*[^;]+;[\r\n]*/g,
            /Object\.defineProperty\(exports,[\s\S]*?\);[\r\n]*/g,
            /var [a-zA-Z_$][a-zA-Z0-9_$]*_exports\s*=\s*\{\};[\r\n]*/g
        ];

        for (const pattern of patterns) {
            content = content.replace(pattern, '');
        }

        await writeFile(filePath, content, 'utf8');
        
        if (debug) {
            console.log(chalk.gray(`Stripped CommonJS wrapper from ${basename(filePath)}`));
        }
    } catch (error) {
        console.error(chalk.red(`Failed to strip CommonJS wrapper from ${filePath}:`), error);
    }
}

// Path helpers
export function getOutputPath(inputFile: string, inputDir: string, outputDir: string): string {
    return join(outputDir, relative(inputDir, inputFile).replace(/\.ts$/, ".js"));
}

export function getRelativePath(file: string, baseDir: string): string {
    return relative(baseDir, file);
}