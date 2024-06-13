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

const RETURN_MSG = "\nreturn msg;";
const DEFAULT_BLACKLIST = ["node_modules", /\.d\.ts$/];

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
        default: true,
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
    .help()
    .alias("help", "h")
    .parseSync();

const inputDir = argv.inputDir;
const outputDir = argv.outputDir;
const emptyOutDir = argv.emptyOutDir;
const recursive = argv.recursive;
const watch = argv.watch;

const BLACKLIST = [...DEFAULT_BLACKLIST];

function getFiles(dir: string, recursive: boolean): string[] {
    let files: string[] = [];
    const list = fs.readdirSync(dir);

    list.forEach((file) => {
        file = path.resolve(dir, file);
        const basename = path.basename(file);

        if (
            BLACKLIST.some((blacklist) =>
                blacklist instanceof RegExp
                    ? blacklist.test(file)
                    : file.includes(blacklist)
            )
        ) {
            console.log(chalk.yellow(`Skipping blacklisted directory: ${file}`));
            return;
        }

        const stat = fs.statSync(file);

        if (stat && stat.isDirectory() && recursive) {
            console.log(chalk.blue(`Entering directory: ${file}`));
            files = files.concat(getFiles(file, recursive));
        } else if (stat && stat.isFile() && file.endsWith(".ts")) {
            console.log(chalk.green(`Found file: ${file}`));
            files.push(file);
        }
    });

    return files;
}

function createViteConfig(inputFile: string, outputDir: string) {
    const name = path.relative(inputDir, inputFile).replace(/\.ts$/, "");

    console.log(chalk.magenta(`Building ${name} from ${inputFile}`));

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

function buildFiles() {
    if (emptyOutDir) {
        console.log(chalk.red(`Emptying output directory: ${outputDir}`));

        try {
            fs.rmSync(outputDir, {
                recursive: true,
                force: true,
                maxRetries: 3,
                retryDelay: 100
            });
        } catch (error) {
            console.error(chalk.red("Failed to empty output directory"), error);
        }
    }

    const files = getFiles(inputDir, recursive);

    files.forEach((inputFile) => {
        const viteConfig = createViteConfig(inputFile, outputDir);

        console.log(chalk.blue("Building..."));

        build(viteConfig)
            .then(() => {
                console.log(chalk.green("Build completed successfully"));
            })
            .catch((error) => {
                console.error(chalk.red("Build failed"), error);
            });
    });
}

buildFiles();

if (watch) {
    const watcher = chokidar.watch(inputDir, {
        ignored: BLACKLIST,
        persistent: true
    });

    watcher.on("change", (path) => {
        console.log(chalk.blue(`File changed: ${path}`));
        buildFiles();
    });

    console.log(chalk.cyan(`Watching for changes in ${inputDir}...`));
}
