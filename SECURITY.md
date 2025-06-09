# Security Policy

## Introduction

Thank you for helping us keep Local Operator UI secure. Local Operator UI strives to be a secure Electron-based desktop application for interacting with the Local Operator agent environment. Your vigilance in reporting any potential security vulnerabilities is essential to maintaining a trustworthy and robust system. This policy outlines how to report issues and how we address them.

## Supported Versions

It is recommended to use the latest version of the Local Operator UI application. The latest version can be found on our [GitHub releases page](https://github.com/damianvtran/local-operator-ui/releases).

Local Operator UI is built with:

- Electron
- React
- TypeScript
- Material UI

And is maintained with strict security practices including:

- Regular dependency updates and scanning
- Automated linting and formatting with Biome
- Type checking with TypeScript
- Comprehensive testing with Jest

Security updates and patches will be released for all actively maintained versions.

## Security Features

Local Operator UI implements a security-focused architecture with emphasis on local operation:

- **Local-First Architecture:**  
  The UI and backend run locally on the user's device, minimizing exposure to external threats. This local-first approach ensures that sensitive operations remain contained within the user's environment.

- **On-Device Credential Management:**  
  All credentials and secrets are stored and transmitted only on the user's device, never leaving their system. This eliminates the risk of credential exposure through network transmission.

- **Backend Security Validation:**  
  The backend performs rigorous security validations where a separate conversation with the LLM is engaged to check code before execution. This provides an additional layer of security review independent from the primary agent.

- **User Confirmation for Sensitive Operations:**  
  The UI requires explicit user confirmation for operations that might impact system security or stability.

- **Electron Security Hardening:**  
  The application follows Electron security best practices to prevent common vulnerabilities in desktop applications.

- **Continuous Integration Security Checks:**  
  Our CI pipeline includes linting, type checking, and testing to catch issues early and to enforce secure coding practices. Security features are always included in the test suites.

## Reporting a Vulnerability

If you identify a security-related vulnerability or security incident in Local Operator UI, we invite you to [report the vulnerability privately](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) and create a GitHub Security Advisory on our repository. Your advisory helps us quickly address potential risks and informs the community about the issue. When creating the advisory, please include:

1. **Detailed Description:**  
   Provide a clear explanation of the vulnerability or security incident, including any relevant context that can help us understand its nature.

2. **Reproduction Steps:**  
   List the steps to reproduce the problem, including any code snippets, logs, screenshots, or other pertinent details.

3. **Impact Assessment:**  
   Describe the potential impact, including what systems or data might be affected and any associated risks to end users.

4. **Additional Information:**  
   If applicable, include any mitigating factors, suggested fixes, or further observations that could assist in resolving the issue. Optionally, provide your contact information for follow-up questions.

Please ensure that sensitive details are managed securely. You can update your advisory with additional information as necessary. Our security team will review your submission promptly and work toward a timely resolution.

## Disclosure Policy

We follow responsible disclosure practices. Once a vulnerability or incident is confirmed and addressed, we will:

- Publish a public security advisory on GitHub detailing the issue, affected versions, and upgrade instructions.
- Provide a timeline for the release of patches or fixes.

## Contact

For any additional security-related inquiries or assistance with creating a GitHub Security Advisory, please contact:

- **Email:** [damian@local-operator.com](mailto:damian@local-operator.com)

## Additional Resources

For further guidance on creating GitHub Security Advisories and responsible disclosure practices, please refer to the [GitHub Security Advisories Documentation](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/creating-a-repository-security-advisory).

Thank you for your commitment to keeping Local Operator UI secure.
