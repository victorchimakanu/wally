// @ts-check
import { themes as prismThemes } from "prism-react-renderer";

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Wally",
  tagline: "On-device agentic finance. Built on QVAC and WDK.",
  favicon: "img/wally-logo.svg",

  future: {
    v4: true,
  },

  url: "http://localhost:3001",
  baseUrl: "/",

  organizationName: "wally",
  projectName: "wally-docs",

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.js",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: "dark",
        disableSwitch: true,
        respectPrefersColorScheme: false,
      },
      navbar: {
        title: "Wally",
        logo: {
          alt: "Wally",
          src: "img/wally-logo.svg",
        },
        items: [
          {
            href: "http://localhost:3000",
            label: "open Wally ↗",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        copyright: "Wally — a reference app for agentic finance on QVAC + WDK. Everything runs on your device.",
      },
      prism: {
        theme: prismThemes.vsDark,
        additionalLanguages: ["json", "bash"],
      },
    }),
};

export default config;
