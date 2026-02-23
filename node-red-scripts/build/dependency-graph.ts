/**
 * Bidirectional Dependency Graph
 *
 * Tracks import relationships between TypeScript files to enable smart incremental
 * compilation. Maintains both forward (file → dependencies) and reverse (dependency →
 * dependents) mappings for efficient traversal.
 *
 * When a dependency changes, the reverse graph enables quick identification of all
 * downstream files that need recompilation via depth-first search.
 *
 * @module build/dependency-graph
 *
 * @example
 * const graph = new DependencyGraph();
 * graph.addDependency("app.ts", "utils.ts");
 * graph.addDependency("service.ts", "utils.ts");
 *
 * // When utils.ts changes:
 * graph.getAffectedFiles("utils.ts"); // Returns ["app.ts", "service.ts"]
 */

import chalk from "chalk";

export class DependencyGraph {
    /** Forward mapping: file → dependencies it imports */
    private graph: Map<string, Set<string>> = new Map();

    /** Reverse mapping: dependency → files that import it */
    private reverseGraph: Map<string, Set<string>> = new Map();

    /**
     * Registers a dependency relationship between files.
     * Updates both forward (file → deps) and reverse (dep → dependents) graphs.
     *
     * @param file - Source file that imports the dependency
     * @param dependency - File being imported
     * @param debug - Enable logging of dependency additions
     */
    addDependency(file: string, dependency: string, debug: boolean = false): void {
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

    /**
     * Retrieves all direct dependencies of a file.
     *
     * @param file - File to query
     * @returns Array of files that this file imports
     */
    getDependencies(file: string): string[] {
        return this.graph.has(file) ? Array.from(this.graph.get(file)!) : [];
    }

    /**
     * Identifies all files affected by a change to the given file.
     * Uses depth-first search on reverse graph to find all downstream dependents.
     *
     * @param file - Changed file
     * @param debug - Enable logging of affected files
     * @returns Array of files that transitively depend on the changed file
     *
     * @example
     * // If utils.ts changes, finds all files that import it (directly or transitively)
     * graph.getAffectedFiles("utils.ts"); // Returns ["app.ts", "service.ts", "controller.ts"]
     */
    getAffectedFiles(file: string, debug: boolean = false): string[] {
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

    /**
     * Clears all dependency relationships from both graphs.
     */
    clear(): void {
        this.graph.clear();
        this.reverseGraph.clear();
    }

    /**
     * Prints both forward and reverse dependency graphs to console.
     * Used for debugging and visualizing dependency relationships.
     */
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