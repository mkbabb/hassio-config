import chalk from "chalk";

export class DependencyGraph {
    private graph: Map<string, Set<string>> = new Map();
    private reverseGraph: Map<string, Set<string>> = new Map();

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

    getDependencies(file: string): string[] {
        return this.graph.has(file) ? Array.from(this.graph.get(file)!) : [];
    }

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