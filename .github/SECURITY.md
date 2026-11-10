# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem.

Report it privately through GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability): Security tab → Report a vulnerability. If that is not possible, contact an owner of the [CinderMed organization](https://github.com/CinderMed).

Please include the affected version or commit, steps to reproduce and the impact. Do not include real patient data or real credentials in the report.

We acknowledge reports within 5 working days and agree a disclosure date with the reporter once a fix is available.

## Supported versions

Until `1.0.0`, only the latest `0.x` release receives security fixes.

## Scope notes

- The workbench stores dictionaries and mappings, not patient data. Patient data or credentials found in the database, logs, exported packages or the repository are a security issue.
- API keys and terminology credentials belong only in the server's environment variables (see `.env.example`).
