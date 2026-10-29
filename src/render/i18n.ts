// SPDX-FileCopyrightText: 2026 OpenCredits contributors
// SPDX-License-Identifier: Apache-2.0

export interface Messages {
  defaultTitle: string;
  defaultIntro: string;
  componentCount: (count: number) => string;
  lastUpdated: string;
  skipLink: string;
  indexLabel: string;
  licenseLabel: string;
  copyrightLabel: string;
  sourceLabel: string;
  versionsLabel: string;
  showLicenseText: string;
  noticeHeading: string;
  licenseTextAt: string;
  noLicenseText: string;
  notSpecified: string;
  backToIndex: string;
  emptyState: string;
  generatedWith: string;
  otherCharacters: string;
}

const en: Messages = {
  defaultTitle: 'Open source licenses',
  defaultIntro:
    'This product is built with open source software. Each component is listed with its license, its copyright holders and the full license text.',
  componentCount: (count) => (count === 1 ? '1 open source component' : `${count} open source components`),
  lastUpdated: 'Last updated',
  skipLink: 'Skip to the component list',
  indexLabel: 'Components by first letter',
  licenseLabel: 'License',
  copyrightLabel: 'Copyright',
  sourceLabel: 'Source',
  versionsLabel: 'Versions',
  showLicenseText: 'License text',
  noticeHeading: 'Notice',
  licenseTextAt: 'Read the full license text at',
  noLicenseText: 'No license text was published with this component.',
  notSpecified: 'Not specified',
  backToIndex: 'Back to the index',
  emptyState: 'No open source components are listed yet. The list updates automatically after the next scan.',
  generatedWith: 'Generated with OpenCredits',
  otherCharacters: 'Other',
};

const de: Messages = {
  defaultTitle: 'Open-Source-Lizenzen',
  defaultIntro:
    'Dieses Produkt wird mit Open-Source-Software entwickelt. Hier finden Sie jede Komponente mit ihrer Lizenz, den Rechteinhabern und dem vollständigen Lizenztext.',
  componentCount: (count) => (count === 1 ? '1 Open-Source-Komponente' : `${count} Open-Source-Komponenten`),
  lastUpdated: 'Zuletzt aktualisiert',
  skipLink: 'Direkt zur Komponentenliste',
  indexLabel: 'Komponenten nach Anfangsbuchstabe',
  licenseLabel: 'Lizenz',
  copyrightLabel: 'Copyright',
  sourceLabel: 'Quelle',
  versionsLabel: 'Versionen',
  showLicenseText: 'Lizenztext',
  noticeHeading: 'Hinweis',
  licenseTextAt: 'Den vollständigen Lizenztext finden Sie unter',
  noLicenseText: 'Für diese Komponente wurde kein Lizenztext veröffentlicht.',
  notSpecified: 'Nicht angegeben',
  backToIndex: 'Zurück zum Index',
  emptyState: 'Derzeit sind keine Open-Source-Komponenten aufgeführt. Die Liste wird nach dem nächsten Scan automatisch aktualisiert.',
  generatedWith: 'Erstellt mit OpenCredits',
  otherCharacters: 'Weitere',
};

export const MESSAGES: Record<'en' | 'de', Messages> = { en, de };
