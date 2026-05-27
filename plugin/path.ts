import path from "node:path";

export function toGuestPath(hostPath: string, directory: string, workspace: string) {
  if (hostPath === workspace || hostPath.startsWith(`${workspace}/`)) return hostPath;

  const absolute = path.resolve(directory, hostPath);
  const relative = path.relative(directory, absolute);
  if (relative === "") return workspace;
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return path.posix.join(workspace, relative.split(path.sep).join(path.posix.sep));
}
