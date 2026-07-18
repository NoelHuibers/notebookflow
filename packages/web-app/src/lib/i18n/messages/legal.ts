// `legal` namespace — bilingual legal documents and the contact form.
export const en = {
  impressum: "Legal notice",
  datenschutz: "Privacy policy",
  agb: "Terms of service",
  shared: {
    updated: "Last updated: 19 July 2026",
    reviewNotice:
      "These texts describe the current NotebookFlow implementation. They should receive individual legal review before a public launch.",
  },
  imprint: {
    providerTitle: "Service provider",
    providerBasis: "Information pursuant to Section 5 DDG",
    contactTitle: "Contact",
    contactIntro:
      "For questions about NotebookFlow, these legal pages, or your data, contact the operator by email or use the form below.",
    emailLabel: "Email",
    formTitle: "Contact form",
    formIntro:
      "The form prepares an email in your email application. Its contents are not submitted to a NotebookFlow server.",
  },
  contact: {
    nameLabel: "Name",
    emailLabel: "Your email address",
    subjectLabel: "Subject",
    messageLabel: "Message",
    consentLabel:
      "I understand that submitting opens my email application and that the email providers involved process the message when I send it.",
    submit: "Open email application",
    fallbackSubject: "Contact request",
    opened:
      "Your email application should now be open. If it did not open, send your message directly to notebookflow@huibers.io.",
    directPrefix: "Alternatively, email",
  },
  privacy: {
    intro:
      "This privacy policy explains how Noel Huibers, operating NotebookFlow, processes personal data in the hosted NotebookFlow web application and its associated execution service. A separately hosted deployment is controlled by its respective operator.",
    controllerTitle: "Controller",
    controllerBody:
      "The controller is Noel Huibers, 81737 München, Germany. Privacy requests can be sent to notebookflow@huibers.io or through the contact form in the legal notice.",
    dataTitle: "Data processed and purposes",
    data: {
      account:
        "Account and sign-in data: provider account identifier, name, email address, profile image, verification status, OAuth tokens and scopes, session token, IP address, and user agent. These data create and secure your account and authenticated sessions.",
      workspace:
        "Workspace data: notebook names and serialized notebook/workspace content that you explicitly save to the hosted service. These data provide cloud persistence and synchronization.",
      key: "Provider-key data: provider and model settings and, only when you opt in, an API key encrypted at rest with AES-256-GCM. The active key is decrypted in memory when needed for your request.",
      execution:
        "Execution and upload data: notebook cells, prompts, selected files, outputs, errors, and the active provider key can be sent to the configured execution engine and the AI provider you select when you request execution or AI assistance.",
      technical:
        "Technical data: request metadata, IP addresses, user agents, timestamps, rate-limit counters, and operational or security logs needed to deliver, protect, and troubleshoot the service.",
    },
    oauthTitle: "Sign-in with GitHub or Google",
    oauthBody:
      "When you choose GitHub or Google sign-in, you are redirected to that provider. NotebookFlow receives the account details and credentials needed for sign-in. GitHub or Google also processes the sign-in under its own privacy terms. NotebookFlow does not receive your provider password.",
    hostingTitle: "Hosting and service providers",
    hostingBody:
      "The hosted web application runs on Vercel, account and saved-workspace data use Turso/libSQL, and the hosted execution engine runs on Fly.io. GitHub and Google provide optional OAuth sign-in. The AI provider selected by you receives request content only when you use the corresponding AI feature. These providers process data only to the extent required for their respective service and configuration.",
    contactTitle: "Contact messages",
    contactBody:
      "The contact form does not post its fields to NotebookFlow. It creates a pre-filled email locally and opens your email application. If you send that email, the sender's and recipient's email providers process the address, message, attachments, and delivery metadata. Messages are retained only as long as needed to answer the request and meet applicable record-keeping duties.",
    basesTitle: "Legal bases",
    bases: {
      service:
        "Article 6(1)(b) GDPR for account creation, saved workspaces, requested execution, and other steps needed to provide the service you request.",
      security:
        "Article 6(1)(f) GDPR for service security, abuse prevention, debugging, and reliable operation. The legitimate interest is operating and protecting NotebookFlow and its users.",
      law: "Article 6(1)(c) GDPR where processing is necessary to comply with a legal obligation, and Article 6(1)(a) GDPR where consent is expressly requested for an optional future feature.",
    },
    recipientsTitle: "Recipients and international transfers",
    recipientsBody:
      "Data may be disclosed to Vercel, Turso, Fly.io, GitHub, Google, and the AI provider you select, depending on the feature used. Some providers or subprocessors may process data outside the European Economic Area. Where GDPR Chapter V applies, a valid transfer mechanism such as an adequacy decision or appropriate safeguards is required.",
    retentionTitle: "Retention",
    retentionBody:
      "Sessions expire after at most seven days. Account, OAuth, saved-workspace, and opt-in provider-key data are retained until you remove them, close the account, or request deletion, subject to required legal retention. Uploaded files remain in the configured engine storage until removed or the associated service data is deleted. Security and infrastructure logs follow the shortest operational period supported by the relevant provider, unless they are needed to investigate abuse or establish legal claims.",
    requiredTitle: "Is providing data required?",
    requiredBody:
      "You can view public pages without an account. Account data is required for signed-in cloud features. Notebook content, uploads, and provider keys are provided voluntarily, but the requested feature cannot operate without the data it needs. You may keep a provider key only in your browser instead of saving it to your account.",
    rightsTitle: "Your rights",
    rightsBody:
      "Subject to the statutory conditions, you may request access, correction, deletion, restriction, data portability, or object to processing based on legitimate interests. You may withdraw consent at any time for the future. Send requests to notebookflow@huibers.io. Identity verification may be required before account data is disclosed or changed.",
    complaintTitle: "Right to complain",
    complaintBody:
      "You may complain to a data-protection supervisory authority. The authority responsible for private-sector controllers in Bavaria is the Bayerisches Landesamt für Datenschutzaufsicht (BayLDA), www.lda.bayern.de.",
    automationTitle: "Automated decisions",
    automationBody:
      "NotebookFlow does not make decisions producing legal or similarly significant effects through solely automated processing. AI-generated suggestions and outputs may be inaccurate and remain subject to your review.",
    securityTitle: "Security",
    securityBody:
      "NotebookFlow uses transport encryption in production, restricted session cookies, owner-scoped records, rate limiting, and authenticated encryption for opt-in cloud-stored provider keys. No online service can guarantee absolute security.",
    changesTitle: "Changes to this policy",
    changesBody:
      "This policy will be updated when the service, providers, or legal requirements materially change. The date at the top identifies the current version.",
    storageTitle: "Cookies and local browser storage",
    storageIntro:
      "NotebookFlow currently uses the following first-party storage for sign-in and user-selected functionality.",
    labels: {
      names: "Name",
      category: "Classification",
      purpose: "Purpose",
      retention: "Retention",
    },
    entries: {
      session: {
        title: "Signed-in session cookie",
        category: "Essential",
        purpose:
          "Keeps you signed in and authenticates account requests. The cookie is HttpOnly, SameSite=Lax, and Secure in production.",
        retention: "Up to seven days; deleted when you sign out.",
      },
      oauth: {
        title: "Temporary OAuth state cookie",
        category: "Essential",
        purpose:
          "Protects GitHub and Google sign-in by correlating the sign-in request with its callback. The cookie is HttpOnly, SameSite=Lax, and Secure in production.",
        retention: "Up to ten minutes.",
      },
      locale: {
        title: "Language preference cookie",
        category: "Functional (selected by you)",
        purpose:
          "Remembers the language you explicitly select so server-rendered and browser-rendered pages use the same language.",
        retention: "One year, or until you delete it in your browser.",
      },
      settings: {
        title: "Application settings",
        category: "Functional (selected by you)",
        purpose:
          "Stores your engine URL, theme, model/provider, and optional BYOK API key in this browser. A key is stored in your account only if you explicitly choose that option; the active key is sent when you make an AI request.",
        retention: "Until you change the settings or clear this site's browser storage.",
      },
      panels: {
        title: "Panel layout",
        category: "Functional (selected by you)",
        purpose:
          "Remembers which workspace panels you collapsed. The v1 name is read only to preserve layouts saved by older versions.",
        retention: "Until you change the layout or clear this site's browser storage.",
      },
    },
    analyticsTitle: "Analytics and tracking",
    analyticsBody:
      "NotebookFlow currently uses no analytics, advertising, cross-site tracking, or tracking cookies.",
    consentTitle: "Consent posture",
    consentBody:
      "No consent banner is currently shown because storage is limited to essential sign-in technology and functionality you request, and no analytics or tracking is enabled. If non-essential storage or tracking is introduced, it will remain disabled until you opt in and this disclosure is updated.",
    storageLegalBasis: "Storage on your device is assessed under Section 25(2)(2) TDDDG.",
  },
  terms: {
    intro:
      "These terms govern use of the free NotebookFlow hosted service provided by Noel Huibers. By creating an account or using signed-in features, you agree to them. Public informational pages can be viewed without accepting these terms.",
    providerTitle: "Provider and scope",
    providerBody:
      "NotebookFlow is provided by Noel Huibers, 81737 München, Germany. The service is currently a free beta. Paid plans or materially different services will require separate or updated terms.",
    serviceTitle: "Service",
    serviceBody:
      "NotebookFlow provides a visual interface for composing and executing notebook pipelines, saving workspaces, and optionally requesting AI assistance. Features may be experimental, change during the beta, or depend on external services selected by you.",
    accountTitle: "Accounts",
    accountBody:
      "You must be entitled to use the GitHub or Google account used to sign in and keep access to it secure. You are responsible for activity under your account and should notify NotebookFlow promptly of suspected unauthorized access.",
    contentTitle: "Your content",
    contentBody:
      "You retain rights in notebooks, files, prompts, and other content you provide. You grant NotebookFlow only the limited rights necessary to host, transmit, process, and back up that content to provide features you request. You are responsible for having the rights and permissions needed for your content and data.",
    acceptableTitle: "Acceptable use",
    acceptableBody:
      "Do not use NotebookFlow unlawfully; infringe others' rights; upload malware; probe or bypass security controls; disrupt or overload the service; access another person's account or data; or submit secrets and personal data you are not authorized to process. Automated high-volume use requires prior agreement.",
    byokTitle: "AI features and bring-your-own-key",
    byokBody:
      "When you use an AI feature, prompts, notebook context, and related inputs are sent to the provider and model you select. You are responsible for that provider account, its terms, charges, usage limits, and the legality of submitted data. AI output can be incomplete or wrong and must be reviewed before use. It is not professional advice.",
    availabilityTitle: "Beta availability and changes",
    availabilityBody:
      "The free beta is provided without a guarantee of uninterrupted availability, permanent storage, or continued availability of a particular feature. NotebookFlow may maintain, limit, change, or discontinue the service. Keep independent backups; workspace export is available for that purpose.",
    terminationTitle: "Suspension and termination",
    terminationBody:
      "You may stop using the service at any time and may request deletion by email. NotebookFlow may restrict or suspend access where reasonably necessary for security, unlawful or abusive use, material breach of these terms, provider restrictions, or discontinuation of the service. Where practical, advance notice will be given.",
    liabilityTitle: "Liability",
    liabilityBody:
      "Liability is unlimited for intent and gross negligence, injury to life, body, or health, fraudulently concealed defects, expressly assumed guarantees, and mandatory statutory liability. For simple negligence, liability exists only for breach of an essential contractual duty and is limited to the foreseeable, typical damage. Otherwise, liability for simple negligence is excluded to the extent permitted by law.",
    lawTitle: "Applicable law",
    lawBody:
      "German law applies, excluding the UN Convention on Contracts for the International Sale of Goods. Mandatory consumer protections and mandatory rules concerning jurisdiction remain unaffected. The German text is authoritative to the extent legally permitted; the English text is provided for convenience.",
    changesTitle: "Changes to these terms",
    changesBody:
      "These terms may be updated for legal, security, or material service changes. Material changes will be communicated in an appropriate form before they take effect. Continued use after the effective date constitutes acceptance only where permitted by law.",
    contactTitle: "Contact",
    contactBody:
      "Questions about these terms can be sent to notebookflow@huibers.io or through the contact form in the legal notice.",
  },
};

export const de: typeof en = {
  impressum: "Impressum",
  datenschutz: "Datenschutzerklärung",
  agb: "Nutzungsbedingungen (AGB)",
  shared: {
    updated: "Stand: 19. Juli 2026",
    reviewNotice:
      "Diese Texte beschreiben die aktuelle Umsetzung von NotebookFlow. Vor einem öffentlichen Start sollten sie individuell rechtlich geprüft werden.",
  },
  imprint: {
    providerTitle: "Diensteanbieter",
    providerBasis: "Angaben gemäß § 5 DDG",
    contactTitle: "Kontakt",
    contactIntro:
      "Bei Fragen zu NotebookFlow, diesen Rechtstexten oder Ihren Daten erreichen Sie den Anbieter per E-Mail oder über das folgende Formular.",
    emailLabel: "E-Mail",
    formTitle: "Kontaktformular",
    formIntro:
      "Das Formular bereitet eine E-Mail in Ihrer E-Mail-Anwendung vor. Die Inhalte werden nicht an einen NotebookFlow-Server übermittelt.",
  },
  contact: {
    nameLabel: "Name",
    emailLabel: "Ihre E-Mail-Adresse",
    subjectLabel: "Betreff",
    messageLabel: "Nachricht",
    consentLabel:
      "Mir ist bekannt, dass beim Absenden meine E-Mail-Anwendung geöffnet wird und die beteiligten E-Mail-Anbieter die Nachricht verarbeiten, sobald ich sie versende.",
    submit: "E-Mail-Anwendung öffnen",
    fallbackSubject: "Kontaktanfrage",
    opened:
      "Ihre E-Mail-Anwendung sollte jetzt geöffnet sein. Falls sie nicht geöffnet wurde, senden Sie Ihre Nachricht direkt an notebookflow@huibers.io.",
    directPrefix: "Alternativ per E-Mail an",
  },
  privacy: {
    intro:
      "Diese Datenschutzerklärung erläutert, wie Noel Huibers als Betreiber von NotebookFlow personenbezogene Daten in der gehosteten NotebookFlow-Webanwendung und dem zugehörigen Ausführungsdienst verarbeitet. Für eine separat gehostete Installation ist deren jeweiliger Betreiber verantwortlich.",
    controllerTitle: "Verantwortlicher",
    controllerBody:
      "Verantwortlicher ist Noel Huibers, 81737 München, Deutschland. Datenschutzanfragen können an notebookflow@huibers.io oder über das Kontaktformular im Impressum gesendet werden.",
    dataTitle: "Verarbeitete Daten und Zwecke",
    data: {
      account:
        "Konto- und Anmeldedaten: Anbieter-Konto-ID, Name, E-Mail-Adresse, Profilbild, Verifizierungsstatus, OAuth-Token und Berechtigungsumfang, Sitzungs-Token, IP-Adresse und User-Agent. Diese Daten dienen der Erstellung und Absicherung des Kontos und angemeldeter Sitzungen.",
      workspace:
        "Arbeitsbereichsdaten: Notebook-Namen und serialisierte Notebook-/Arbeitsbereichsinhalte, die Sie ausdrücklich im gehosteten Dienst speichern. Diese Daten ermöglichen Cloud-Speicherung und Synchronisierung.",
      key: "Anbieterschlüssel-Daten: Anbieter- und Modelleinstellungen sowie nur nach Ihrer ausdrücklichen Auswahl ein mit AES-256-GCM verschlüsselt gespeicherter API-Schlüssel. Der aktive Schlüssel wird bei Bedarf für Ihre Anfrage im Arbeitsspeicher entschlüsselt.",
      execution:
        "Ausführungs- und Upload-Daten: Notebook-Zellen, Prompts, ausgewählte Dateien, Ausgaben, Fehler und der aktive Anbieterschlüssel können an die konfigurierte Ausführungs-Engine und den von Ihnen gewählten KI-Anbieter gesendet werden, wenn Sie eine Ausführung oder KI-Unterstützung anfordern.",
      technical:
        "Technische Daten: Anfrage-Metadaten, IP-Adressen, User-Agents, Zeitstempel, Rate-Limit-Zähler sowie Betriebs- oder Sicherheitsprotokolle, die zur Bereitstellung, Absicherung und Fehlerbehebung des Dienstes erforderlich sind.",
    },
    oauthTitle: "Anmeldung mit GitHub oder Google",
    oauthBody:
      "Wenn Sie die Anmeldung mit GitHub oder Google wählen, werden Sie zu diesem Anbieter weitergeleitet. NotebookFlow erhält die für die Anmeldung benötigten Kontodaten und Berechtigungsnachweise. GitHub oder Google verarbeitet die Anmeldung zusätzlich nach den eigenen Datenschutzbedingungen. NotebookFlow erhält Ihr Anbieter-Passwort nicht.",
    hostingTitle: "Hosting und Dienstleister",
    hostingBody:
      "Die gehostete Webanwendung läuft bei Vercel, Konto- und gespeicherte Arbeitsbereichsdaten verwenden Turso/libSQL und die gehostete Ausführungs-Engine läuft bei Fly.io. GitHub und Google ermöglichen die optionale OAuth-Anmeldung. Der von Ihnen gewählte KI-Anbieter erhält Anfrageinhalte nur bei Nutzung der entsprechenden KI-Funktion. Diese Anbieter verarbeiten Daten nur in dem Umfang, der für den jeweiligen Dienst und dessen Konfiguration erforderlich ist.",
    contactTitle: "Kontaktnachrichten",
    contactBody:
      "Das Kontaktformular sendet seine Felder nicht an NotebookFlow. Es erstellt lokal eine vorausgefüllte E-Mail und öffnet Ihre E-Mail-Anwendung. Wenn Sie diese E-Mail versenden, verarbeiten die E-Mail-Anbieter von Absender und Empfänger die Adresse, Nachricht, Anhänge und Zustellungsmetadaten. Nachrichten werden nur so lange aufbewahrt, wie dies zur Bearbeitung der Anfrage und zur Erfüllung einschlägiger Aufbewahrungspflichten erforderlich ist.",
    basesTitle: "Rechtsgrundlagen",
    bases: {
      service:
        "Art. 6 Abs. 1 Buchst. b DSGVO für Kontoerstellung, gespeicherte Arbeitsbereiche, angeforderte Ausführungen und weitere Schritte, die zur Bereitstellung des von Ihnen gewünschten Dienstes erforderlich sind.",
      security:
        "Art. 6 Abs. 1 Buchst. f DSGVO für Dienstsicherheit, Missbrauchsabwehr, Fehlerbehebung und zuverlässigen Betrieb. Das berechtigte Interesse besteht im Betrieb und Schutz von NotebookFlow und seiner Nutzer.",
      law: "Art. 6 Abs. 1 Buchst. c DSGVO, soweit die Verarbeitung zur Erfüllung einer rechtlichen Verpflichtung erforderlich ist, und Art. 6 Abs. 1 Buchst. a DSGVO, wenn für eine künftige optionale Funktion ausdrücklich eine Einwilligung eingeholt wird.",
    },
    recipientsTitle: "Empfänger und internationale Übermittlungen",
    recipientsBody:
      "Daten können abhängig von der genutzten Funktion an Vercel, Turso, Fly.io, GitHub, Google und den von Ihnen gewählten KI-Anbieter übermittelt werden. Einige Anbieter oder Unterauftragnehmer können Daten außerhalb des Europäischen Wirtschaftsraums verarbeiten. Soweit Kapitel V DSGVO anwendbar ist, ist ein gültiger Übermittlungsmechanismus wie ein Angemessenheitsbeschluss oder geeignete Garantien erforderlich.",
    retentionTitle: "Speicherdauer",
    retentionBody:
      "Sitzungen laufen nach höchstens sieben Tagen ab. Konto-, OAuth-, gespeicherte Arbeitsbereichs- und ausdrücklich gespeicherte Anbieterschlüssel-Daten werden bis zu ihrer Entfernung, Kontoschließung oder einem Löschersuchen aufbewahrt, vorbehaltlich gesetzlicher Aufbewahrungspflichten. Hochgeladene Dateien verbleiben im konfigurierten Engine-Speicher, bis sie entfernt oder die zugehörigen Dienstdaten gelöscht werden. Sicherheits- und Infrastrukturprotokolle folgen der kürzesten vom jeweiligen Anbieter unterstützten betrieblichen Dauer, sofern sie nicht zur Untersuchung von Missbrauch oder zur Geltendmachung von Rechtsansprüchen benötigt werden.",
    requiredTitle: "Ist die Bereitstellung erforderlich?",
    requiredBody:
      "Öffentliche Seiten können ohne Konto aufgerufen werden. Kontodaten sind für angemeldete Cloud-Funktionen erforderlich. Notebook-Inhalte, Uploads und Anbieterschlüssel werden freiwillig bereitgestellt; die angeforderte Funktion kann jedoch nicht ohne die benötigten Daten arbeiten. Ein Anbieterschlüssel kann statt im Konto auch ausschließlich im Browser gespeichert werden.",
    rightsTitle: "Ihre Rechte",
    rightsBody:
      "Unter den gesetzlichen Voraussetzungen können Sie Auskunft, Berichtigung, Löschung, Einschränkung oder Datenübertragbarkeit verlangen und einer Verarbeitung auf Grundlage berechtigter Interessen widersprechen. Eine Einwilligung kann jederzeit mit Wirkung für die Zukunft widerrufen werden. Richten Sie Anfragen an notebookflow@huibers.io. Vor Offenlegung oder Änderung von Kontodaten kann eine Identitätsprüfung erforderlich sein.",
    complaintTitle: "Beschwerderecht",
    complaintBody:
      "Sie können sich bei einer Datenschutzaufsichtsbehörde beschweren. Zuständig für nicht-öffentliche Verantwortliche in Bayern ist das Bayerische Landesamt für Datenschutzaufsicht (BayLDA), www.lda.bayern.de.",
    automationTitle: "Automatisierte Entscheidungen",
    automationBody:
      "NotebookFlow trifft keine Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung ausschließlich durch automatisierte Verarbeitung. KI-generierte Vorschläge und Ausgaben können fehlerhaft sein und müssen von Ihnen geprüft werden.",
    securityTitle: "Sicherheit",
    securityBody:
      "NotebookFlow verwendet in der Produktion Transportverschlüsselung, eingeschränkte Sitzungscookies, eigentümerbezogene Datensätze, Rate-Limits und authentifizierte Verschlüsselung für ausdrücklich im Konto gespeicherte Anbieterschlüssel. Kein Online-Dienst kann absolute Sicherheit garantieren.",
    changesTitle: "Änderungen dieser Erklärung",
    changesBody:
      "Diese Erklärung wird aktualisiert, wenn sich Dienst, Anbieter oder rechtliche Anforderungen wesentlich ändern. Das Datum am Seitenanfang kennzeichnet die aktuelle Fassung.",
    storageTitle: "Cookies und lokaler Browserspeicher",
    storageIntro:
      "NotebookFlow verwendet derzeit die folgenden eigenen Speichertechniken für die Anmeldung und ausdrücklich gewählte Funktionen.",
    labels: {
      names: "Name",
      category: "Einordnung",
      purpose: "Zweck",
      retention: "Speicherdauer",
    },
    entries: {
      session: {
        title: "Cookie für die angemeldete Sitzung",
        category: "Technisch notwendig",
        purpose:
          "Hält die Anmeldung aufrecht und authentifiziert Kontoanfragen. Das Cookie ist HttpOnly, SameSite=Lax und in der Produktion Secure.",
        retention: "Höchstens sieben Tage; wird beim Abmelden gelöscht.",
      },
      oauth: {
        title: "Temporäres OAuth-Status-Cookie",
        category: "Technisch notwendig",
        purpose:
          "Schützt die Anmeldung mit GitHub und Google, indem Anmeldeanfrage und Rückruf einander zugeordnet werden. Das Cookie ist HttpOnly, SameSite=Lax und in der Produktion Secure.",
        retention: "Höchstens zehn Minuten.",
      },
      locale: {
        title: "Cookie für die Sprachauswahl",
        category: "Funktional (ausdrücklich ausgewählt)",
        purpose:
          "Speichert die ausdrücklich ausgewählte Sprache, damit server- und browserseitig gerenderte Seiten dieselbe Sprache verwenden.",
        retention: "Ein Jahr oder bis zur Löschung im Browser.",
      },
      settings: {
        title: "Anwendungseinstellungen",
        category: "Funktional (ausdrücklich ausgewählt)",
        purpose:
          "Speichert Engine-URL, Theme, Modell/Anbieter und optional den BYOK-API-Schlüssel in diesem Browser. Ein Schlüssel wird nur nach ausdrücklicher Auswahl im Konto gespeichert; der aktive Schlüssel wird bei einer KI-Anfrage übermittelt.",
        retention:
          "Bis zur Änderung der Einstellungen oder zum Löschen des Website-Speichers im Browser.",
      },
      panels: {
        title: "Panel-Anordnung",
        category: "Funktional (ausdrücklich ausgewählt)",
        purpose:
          "Speichert, welche Arbeitsbereich-Panels eingeklappt wurden. Der v1-Name wird nur gelesen, um mit älteren Versionen gespeicherte Anordnungen zu erhalten.",
        retention:
          "Bis zur Änderung der Anordnung oder zum Löschen des Website-Speichers im Browser.",
      },
    },
    analyticsTitle: "Analyse und Tracking",
    analyticsBody:
      "NotebookFlow verwendet derzeit keine Analyse-, Werbe- oder websiteübergreifenden Tracking-Techniken und keine Tracking-Cookies.",
    consentTitle: "Einwilligungsstatus",
    consentBody:
      "Derzeit wird kein Einwilligungsbanner angezeigt, da die Speicherung auf notwendige Anmeldetechnik und ausdrücklich gewählte Funktionen beschränkt ist und weder Analyse noch Tracking aktiviert sind. Künftige nicht notwendige Speicherung oder Tracking bleiben deaktiviert, bis eine aktive Einwilligung erteilt und diese Information aktualisiert wurde.",
    storageLegalBasis:
      "Die Speicherung auf dem Endgerät wird nach § 25 Abs. 2 Nr. 2 TDDDG bewertet.",
  },
  terms: {
    intro:
      "Diese Bedingungen regeln die Nutzung des kostenlosen gehosteten NotebookFlow-Dienstes von Noel Huibers. Mit der Kontoerstellung oder Nutzung angemeldeter Funktionen stimmen Sie ihnen zu. Öffentliche Informationsseiten können ohne Zustimmung aufgerufen werden.",
    providerTitle: "Anbieter und Geltungsbereich",
    providerBody:
      "NotebookFlow wird von Noel Huibers, 81737 München, Deutschland, angeboten. Der Dienst befindet sich derzeit in einer kostenlosen Beta. Kostenpflichtige Tarife oder wesentlich andere Leistungen erfordern gesonderte oder aktualisierte Bedingungen.",
    serviceTitle: "Leistung",
    serviceBody:
      "NotebookFlow stellt eine visuelle Oberfläche zum Erstellen und Ausführen von Notebook-Pipelines, zum Speichern von Arbeitsbereichen und optional zur Nutzung von KI-Unterstützung bereit. Funktionen können experimentell sein, sich während der Beta ändern oder von durch Sie gewählten externen Diensten abhängen.",
    accountTitle: "Konten",
    accountBody:
      "Sie müssen zur Nutzung des für die Anmeldung verwendeten GitHub- oder Google-Kontos berechtigt sein und dessen Zugang schützen. Sie sind für Aktivitäten unter Ihrem Konto verantwortlich und sollten NotebookFlow bei Verdacht auf unbefugten Zugriff unverzüglich informieren.",
    contentTitle: "Ihre Inhalte",
    contentBody:
      "Sie behalten die Rechte an Notebooks, Dateien, Prompts und sonstigen bereitgestellten Inhalten. Sie räumen NotebookFlow nur die beschränkten Rechte ein, die zum Hosten, Übertragen, Verarbeiten und Sichern dieser Inhalte für die von Ihnen angeforderten Funktionen erforderlich sind. Sie sind dafür verantwortlich, die erforderlichen Rechte und Erlaubnisse für Ihre Inhalte und Daten zu besitzen.",
    acceptableTitle: "Zulässige Nutzung",
    acceptableBody:
      "NotebookFlow darf nicht rechtswidrig genutzt werden. Untersagt sind insbesondere die Verletzung fremder Rechte, das Hochladen von Schadsoftware, die Umgehung oder Prüfung von Sicherheitskontrollen ohne Erlaubnis, Störung oder Überlastung des Dienstes, Zugriff auf fremde Konten oder Daten sowie die Übermittlung von Geheimnissen oder personenbezogenen Daten ohne Verarbeitungsbefugnis. Automatisierte Massennutzung bedarf vorheriger Vereinbarung.",
    byokTitle: "KI-Funktionen und eigene API-Schlüssel",
    byokBody:
      "Bei Nutzung einer KI-Funktion werden Prompts, Notebook-Kontext und zugehörige Eingaben an den von Ihnen gewählten Anbieter und das gewählte Modell gesendet. Sie sind für das Anbieterkonto, dessen Bedingungen, Kosten, Nutzungslimits und die Rechtmäßigkeit übermittelter Daten verantwortlich. KI-Ausgaben können unvollständig oder falsch sein und müssen vor der Nutzung geprüft werden. Sie stellen keine fachliche Beratung dar.",
    availabilityTitle: "Beta-Verfügbarkeit und Änderungen",
    availabilityBody:
      "Die kostenlose Beta wird ohne Garantie einer ununterbrochenen Verfügbarkeit, dauerhaften Speicherung oder Fortführung einer bestimmten Funktion bereitgestellt. NotebookFlow kann den Dienst warten, beschränken, ändern oder einstellen. Bewahren Sie unabhängige Sicherungen auf; hierfür steht der Arbeitsbereichsexport zur Verfügung.",
    terminationTitle: "Sperrung und Beendigung",
    terminationBody:
      "Sie können die Nutzung jederzeit beenden und eine Löschung per E-Mail verlangen. NotebookFlow kann den Zugang beschränken oder sperren, wenn dies aus Sicherheitsgründen, wegen rechtswidriger oder missbräuchlicher Nutzung, eines wesentlichen Verstoßes gegen diese Bedingungen, aufgrund von Anbietervorgaben oder wegen Einstellung des Dienstes angemessen erforderlich ist. Soweit praktikabel, wird dies vorher angekündigt.",
    liabilityTitle: "Haftung",
    liabilityBody:
      "Unbeschränkt gehaftet wird bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit, arglistig verschwiegenen Mängeln, ausdrücklich übernommenen Garantien und zwingender gesetzlicher Haftung. Bei einfacher Fahrlässigkeit besteht eine Haftung nur bei Verletzung einer wesentlichen Vertragspflicht und ist auf den vorhersehbaren, typischen Schaden begrenzt. Im Übrigen ist die Haftung für einfache Fahrlässigkeit soweit gesetzlich zulässig ausgeschlossen.",
    lawTitle: "Anwendbares Recht",
    lawBody:
      "Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts. Zwingende Verbraucherschutzvorschriften und zwingende Gerichtsstandsregelungen bleiben unberührt. Soweit rechtlich zulässig, ist die deutsche Fassung maßgeblich; die englische Fassung dient der Verständlichkeit.",
    changesTitle: "Änderungen dieser Bedingungen",
    changesBody:
      "Diese Bedingungen können wegen rechtlicher, sicherheitsbezogener oder wesentlicher Änderungen des Dienstes angepasst werden. Wesentliche Änderungen werden vor ihrem Inkrafttreten in geeigneter Form mitgeteilt. Eine weitere Nutzung nach dem Geltungsdatum gilt nur soweit gesetzlich zulässig als Zustimmung.",
    contactTitle: "Kontakt",
    contactBody:
      "Fragen zu diesen Bedingungen können an notebookflow@huibers.io oder über das Kontaktformular im Impressum gesendet werden.",
  },
};
