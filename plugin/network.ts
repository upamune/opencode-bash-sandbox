import type { PluginOptions } from "@opencode-ai/plugin";
import { Destination, NetworkPolicy, Rule, type SandboxBuilder } from "microsandbox";
import { resolveEnvRef } from "./env.js";
import {
  booleanOption,
  numberOption,
  stringArrayOption,
  stringOption,
  stringRecordOption,
} from "./options.js";

type SecretInput = {
  hosts?: string[];
  hostPatterns?: string[];
  value: string;
  placeholder?: string;
  injectHeaders?: boolean;
  injectBasicAuth?: boolean;
  injectQuery?: boolean;
  injectBody?: boolean;
  allowAnyHostDangerous?: boolean;
  requireTlsIdentity?: boolean;
};

type DnsConfigBuilder = {
  rebindProtection(enabled: boolean): DnsConfigBuilder;
  nameservers(servers: string[]): DnsConfigBuilder;
  queryTimeoutMs(ms: number): DnsConfigBuilder;
};

type TlsConfigBuilder = {
  bypass(pattern: string): TlsConfigBuilder;
  verifyUpstream(verify: boolean): TlsConfigBuilder;
  interceptedPorts(ports: number[]): TlsConfigBuilder;
  blockQuic(block: boolean): TlsConfigBuilder;
};

type SecretConfigBuilder = {
  env(varName: string): SecretConfigBuilder;
  value(value: string): SecretConfigBuilder;
  placeholder(placeholder: string): SecretConfigBuilder;
  allowHost(host: string): SecretConfigBuilder;
  allowHostPattern(pattern: string): SecretConfigBuilder;
  allowAnyHostDangerous(iUnderstand: boolean): SecretConfigBuilder;
  requireTlsIdentity(enabled: boolean): SecretConfigBuilder;
  injectHeaders(enabled: boolean): SecretConfigBuilder;
  injectBasicAuth(enabled: boolean): SecretConfigBuilder;
  injectQuery(enabled: boolean): SecretConfigBuilder;
  injectBody(enabled: boolean): SecretConfigBuilder;
};

export function configureNetwork(builder: SandboxBuilder, options?: PluginOptions) {
  const allowedHosts = stringArrayOption(options, "allowedHosts") ?? [];
  const allowedInternalHosts = stringArrayOption(options, "allowedInternalHosts") ?? [];
  const blockInternalRanges = booleanOption(options, "blockInternalRanges") ?? true;
  const secretsInput = stringRecordOption(options, "secrets") ?? {};
  const disableNetwork = booleanOption(options, "disableNetwork");
  const allowAllNetwork = booleanOption(options, "allowAllNetwork");
  const maxConnections = numberOption(options, "maxConnections");
  const trustHostCAs = booleanOption(options, "trustHostCAs");
  const nameservers = stringArrayOption(options, "nameservers");
  const dnsQueryTimeoutMs = numberOption(options, "dnsQueryTimeoutMs");
  const tlsBypass = stringArrayOption(options, "tlsBypass") ?? [];
  const tlsInterceptedPorts = options?.tlsInterceptedPorts;
  const tlsVerifyUpstream = booleanOption(options, "tlsVerifyUpstream");
  const tlsBlockQuic = booleanOption(options, "tlsBlockQuic");
  const secretViolationAction = stringOption(options, "secretViolationAction");

  if (disableNetwork === true) {
    return builder.disableNetwork();
  }

  const secretEntries = Object.entries(secretsInput).flatMap(([envVar, raw]) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const secret = raw as SecretInput;
    if (typeof secret.value !== "string") return [];
    return [[envVar, secret] as const];
  });

  if (
    allowAllNetwork !== true &&
    allowedHosts.length === 0 &&
    allowedInternalHosts.length === 0 &&
    secretEntries.length === 0
  ) {
    return builder.network((network) => network.policyJson(JSON.stringify(NetworkPolicy.none())));
  }

  return builder.network((network) => {
    if (allowAllNetwork === true) {
      network.policyJson(JSON.stringify(NetworkPolicy.allowAll()));
    } else {
      const allowedSecretHosts = secretEntries.flatMap(([, secret]) => secret.hosts ?? []);
      const rules = [
        Rule.allowDns(),
        ...allowedHosts.map((host) => Rule.allowEgress(Destination.domain(host))),
        ...allowedInternalHosts.map((host) => Rule.allowEgress(Destination.domain(host))),
        ...allowedSecretHosts.map((host) => Rule.allowEgress(Destination.domain(host))),
      ];

      network.policyJson(
        JSON.stringify({
          defaultEgress: "deny",
          defaultIngress: "deny",
          rules,
        }),
      );
    }

    if (
      nameservers !== undefined ||
      dnsQueryTimeoutMs !== undefined ||
      blockInternalRanges === false ||
      allowedInternalHosts.length > 0
    ) {
      network.dns((dns: DnsConfigBuilder) => {
        if (nameservers !== undefined) dns.nameservers(nameservers);
        if (dnsQueryTimeoutMs !== undefined) dns.queryTimeoutMs(dnsQueryTimeoutMs);
        return dns.rebindProtection(
          blockInternalRanges !== false && allowedInternalHosts.length === 0,
        );
      });
    }

    if (
      tlsBypass.length > 0 ||
      tlsInterceptedPorts !== undefined ||
      tlsVerifyUpstream !== undefined ||
      tlsBlockQuic !== undefined
    ) {
      network.tls((tls: TlsConfigBuilder) => {
        for (const bypass of tlsBypass) tls.bypass(bypass);
        if (
          Array.isArray(tlsInterceptedPorts) &&
          tlsInterceptedPorts.every((port) => typeof port === "number")
        ) {
          tls.interceptedPorts(tlsInterceptedPorts);
        }
        if (tlsVerifyUpstream !== undefined) tls.verifyUpstream(tlsVerifyUpstream);
        if (tlsBlockQuic !== undefined) tls.blockQuic(tlsBlockQuic);
        return tls;
      });
    }

    for (const [envVar, secret] of secretEntries) {
      network.secret((secretBuilder: SecretConfigBuilder) => {
        secretBuilder.env(envVar).value(resolveEnvRef(secret.value));
        if (typeof secret.placeholder === "string") secretBuilder.placeholder(secret.placeholder);
        for (const host of secret.hosts ?? []) secretBuilder.allowHost(host);
        for (const pattern of secret.hostPatterns ?? []) secretBuilder.allowHostPattern(pattern);
        if (secret.allowAnyHostDangerous === true) secretBuilder.allowAnyHostDangerous(true);
        if (secret.requireTlsIdentity !== undefined) {
          secretBuilder.requireTlsIdentity(secret.requireTlsIdentity);
        }
        if (secret.injectHeaders !== undefined) secretBuilder.injectHeaders(secret.injectHeaders);
        if (secret.injectBasicAuth !== undefined) {
          secretBuilder.injectBasicAuth(secret.injectBasicAuth);
        }
        if (secret.injectQuery !== undefined) secretBuilder.injectQuery(secret.injectQuery);
        if (secret.injectBody !== undefined) secretBuilder.injectBody(secret.injectBody);
        return secretBuilder;
      });
    }

    if (secretViolationAction !== undefined) network.onSecretViolation(secretViolationAction);
    if (maxConnections !== undefined) network.maxConnections(maxConnections);
    if (trustHostCAs !== undefined) network.trustHostCAs(trustHostCAs);
    return network;
  });
}
