import { homedir } from "node:os";

export const expandHome = (path: string): string => (path.startsWith("~") ? `${homedir()}${path.slice(1)}` : path);
