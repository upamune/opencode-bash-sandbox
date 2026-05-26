import type { PluginOptions } from "@opencode-ai/plugin";
import type { SandboxBuilder } from "microsandbox";
import { stringRecordOption } from "./options.js";

type PortInput = {
  host: number;
  guest: number;
};

type VolumeInput = {
  guest: string;
  kind: "bind" | "named" | "tmpfs" | "disk";
  source?: string;
  readonly?: boolean;
  sizeMiB?: number;
  format?: string;
  fstype?: string;
};

type RlimitInput = {
  resource: string;
  limit?: number;
  soft?: number;
  hard?: number;
};

export function configurePorts(builder: SandboxBuilder, options?: PluginOptions) {
  const ports = options?.ports;
  if (Array.isArray(ports)) {
    for (const port of ports as PortInput[]) {
      if (typeof port.host === "number" && typeof port.guest === "number") {
        builder.port(port.host, port.guest);
      }
    }
  }

  const udpPorts = options?.udpPorts;
  if (Array.isArray(udpPorts)) {
    for (const port of udpPorts as PortInput[]) {
      if (typeof port.host === "number" && typeof port.guest === "number") {
        builder.portUdp(port.host, port.guest);
      }
    }
  }

  return builder;
}

export function configureRlimits(builder: SandboxBuilder, options?: PluginOptions) {
  const rlimits = options?.rlimits;
  if (!Array.isArray(rlimits)) return builder;

  for (const rlimit of rlimits as RlimitInput[]) {
    if (typeof rlimit.resource !== "string") continue;
    if (typeof rlimit.limit === "number") builder.rlimit(rlimit.resource, rlimit.limit);
    if (typeof rlimit.soft === "number" && typeof rlimit.hard === "number") {
      builder.rlimitRange(rlimit.resource, rlimit.soft, rlimit.hard);
    }
  }

  return builder;
}

export function configureExtraVolumes(builder: SandboxBuilder, options?: PluginOptions) {
  const volumes = options?.volumes;
  if (!Array.isArray(volumes)) return builder;

  for (const volume of volumes as VolumeInput[]) {
    if (typeof volume.guest !== "string") continue;

    builder.volume(volume.guest, (mount) => {
      if (volume.kind === "named" && typeof volume.source === "string") mount.named(volume.source);
      if (volume.kind === "bind" && typeof volume.source === "string") mount.bind(volume.source);
      if (volume.kind === "disk" && typeof volume.source === "string") mount.disk(volume.source);
      if (volume.kind === "tmpfs") mount.tmpfs();
      if (volume.format !== undefined) mount.format(volume.format);
      if (volume.fstype !== undefined) mount.fstype(volume.fstype);
      if (volume.sizeMiB !== undefined) mount.size(volume.sizeMiB);
      if (volume.readonly === true) mount.readonly();
      return mount;
    });
  }

  return builder;
}

export function configurePatches(builder: SandboxBuilder, options?: PluginOptions) {
  const scripts = stringRecordOption(options, "scripts");
  const patchText = stringRecordOption(options, "patchText");

  if (scripts !== undefined) {
    builder.scripts(
      Object.fromEntries(
        Object.entries(scripts).flatMap(([name, content]) =>
          typeof content === "string" ? [[name, content]] : [],
        ),
      ),
    );
  }

  if (patchText !== undefined) {
    builder.patch((patch) => {
      for (const [guestPath, content] of Object.entries(patchText)) {
        if (typeof content === "string") patch.text(guestPath, content, { replace: true });
      }
      return patch;
    });
  }

  return builder;
}
