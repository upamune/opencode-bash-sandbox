import { describe, expect, test } from "bun:test";
import type { NetworkPolicy } from "microsandbox";
import { configureNetwork } from "../plugin/network.ts";

type NetworkState = {
  disabled: boolean;
  policy?: NetworkPolicy;
  rebindProtection?: boolean;
};

function createBuilder(state: NetworkState) {
  const builder = {
    disableNetwork: () => {
      state.disabled = true;
      return builder;
    },
    network: (configure: (network: unknown) => unknown) => {
      const network = {
        policy: (policy: NetworkPolicy) => {
          state.policy = policy;
          return network;
        },
        dns: (configureDns: (dns: unknown) => unknown) => {
          const dns = {
            nameservers: () => dns,
            queryTimeoutMs: () => dns,
            rebindProtection: (enabled: boolean) => {
              state.rebindProtection = enabled;
              return dns;
            },
          };
          configureDns(dns);
          return network;
        },
        tls: () => network,
        secret: () => network,
        onSecretViolation: () => network,
        maxConnections: () => network,
        trustHostCAs: () => network,
      };
      configure(network);
      return builder;
    },
  };

  return builder;
}

describe("configureNetwork", () => {
  test("allows ingress to published TCP and UDP guest ports under deny-by-default policy", () => {
    const state: NetworkState = { disabled: false };

    configureNetwork(createBuilder(state) as never, {
      ports: [{ host: 3000, guest: 3000 }],
      udpPorts: [{ host: 5353, guest: 5353 }],
    });

    expect(state.policy?.defaultIngress).toBe("deny");
    expect(state.policy?.rules).toContainEqual({
      direction: "ingress",
      destination: { kind: "any" },
      protocols: ["tcp"],
      ports: [{ start: 3000, end: 3000 }],
      action: "allow",
    });
    expect(state.policy?.rules).toContainEqual({
      direction: "ingress",
      destination: { kind: "any" },
      protocols: ["udp"],
      ports: [{ start: 5353, end: 5353 }],
      action: "allow",
    });
  });

  test("disables DNS rebind protection when internal hosts are allowed", () => {
    const state: NetworkState = { disabled: false };

    configureNetwork(createBuilder(state) as never, {
      allowedHosts: ["api.example.com"],
      allowedInternalHosts: ["internal.example.com"],
    });

    expect(state.rebindProtection).toBe(false);
  });
});
