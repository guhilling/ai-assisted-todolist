# Datenschutzerklärung

*English version: [Privacy policy](privacy.md)*

Diese Erklärung gilt für TaskFest, die Aufgabenliste unter `taskfest-qa.cloud.hilling.de` und
`taskfest.cloud.hilling.de` („die Anwendung“), und für diese Dokumentationsseite. Sie beschreibt,
was die Anwendung tatsächlich tut, und wird in derselben Änderung angepasst wie das Verhalten, das
sie beschreibt.

Die Anwendung ist ein nicht kommerzielles Demonstrationsprojekt der Hilling IT GmbH. Jeder mit
einem Google-Konto kann sich anmelden. `taskfest-qa.cloud.hilling.de` ist ihre Testumgebung, die
jederzeit geändert oder zurückgesetzt werden kann; dort melden sich außerdem zwei Testkonten an,
die automatisierte Tests verwenden. Sie gehören keiner Person und enthalten nur, was diese Tests
anlegen und wieder löschen.

## Verantwortlicher

Hilling IT GmbH – Anschrift, Geschäftsführung und Registereintrag stehen in ihrem
[Impressum](https://www.hilling.it/impressum/).

E-Mail: demo-apps[at]hilling.de (gegen Spam so geschrieben: `[at]` durch `@` ersetzen)

An diese Adresse richten Sie alles, was diese Erklärung betrifft, auch jede Anfrage nach
„Ihre Rechte“ weiter unten.

## Was verarbeitet wird, wozu und wie lange

### Anmeldung mit Google

Sie melden sich mit Ihrem Google-Konto an. Mit Ihrer Einwilligung auf Googles eigener Seite teilt
Google der Anwendung Ihre **E-Mail-Adresse**, Ihren **Namen**, die Adresse Ihres **Profilbilds**
und eine Kennung Ihres Kontos mit.

- **Ihre E-Mail-Adresse** wird gespeichert, zusammen mit dem Zeitpunkt, zu dem Ihr Konto angelegt
  wurde. Ihr gehören Ihre Aufgaben.
- **Ihr Name und Ihr Bild** dienen nur dazu, Ihnen anzuzeigen, mit welchem Konto Sie angemeldet
  sind. Sie werden bei der Anmeldung aus Googles Anmelde-Token übernommen und mit Ihrer Sitzung
  gespeichert, **nie mit Ihren Aufgaben**; sie werden gelöscht, wenn die Sitzung endet,
  spätestens sieben Tage nach der Anmeldung.

Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO – die Bereitstellung der Anwendung, die Sie nutzen
wollen. Gespeichert, bis Ihr Konto gelöscht wird.

### Ihre Aufgaben

Was Sie eingeben: Beschreibung, Fälligkeitsdatum, Uhrzeit und deren Zeitzone, wenn Sie eine
angeben, Wichtigkeit und Zustand jeder Aufgabe. Außer Ihnen kann niemand Ihre Aufgaben in der
Anwendung sehen.

Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Gespeichert, bis Sie sie löschen oder Ihr Konto
gelöscht wird.

Bitte geben Sie keine sensiblen Informationen ein (zum Beispiel Gesundheitsdaten oder
personenbezogene Daten anderer) – dies ist eine Demonstration und weder für solche Daten gebaut
noch betrieben.

### Dateien, die Sie an Aufgaben anhängen

Was Sie anhängen: PDFs und Bilder, jeweils höchstens 10 MB, zwei pro Aufgabe und fünf insgesamt,
mit ihren Namen, Typen und Größen. Die Dateien werden verschlüsselt in Amazon S3 in der
AWS-Region Frankfurt gespeichert; Namen, Typen und Größen bei Ihren Aufgaben. Ihr Browser sendet
eine Datei direkt an den Speicher und lädt sie von dort, über Links, die die Anwendung nur für Sie
erzeugt und die nach wenigen Minuten nicht mehr funktionieren. Außer Ihnen kann niemand Ihre
Dateien in der Anwendung öffnen, und sie sind nie öffentlich.

Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Gespeichert, bis Sie die Datei entfernen oder ihre
Aufgabe löschen oder Ihr Konto gelöscht wird. Die Dateien einer gelöschten Aufgabe bleiben noch
zehn Minuten erhalten, damit sich das Löschen rückgängig machen lässt, und werden dann gelöscht;
eine Datei, deren Hochladen nie abgeschlossen wurde, nach einer Stunde. Gespeicherte Dateien
werden nicht gesichert: Einmal gelöscht, ist eine Datei weg.

Für Dateien gilt dieselbe Bitte wie für Aufgaben: Hängen Sie bitte nichts Sensibles an.

### Das Sitzungs-Cookie

Die Anmeldung setzt **ein Cookie**, das Sie angemeldet hält. Es enthält nur einen Zufallswert,
der Ihre Sitzung auf dem Server bezeichnet; Ihre Anmelde-Token werden nicht aufbewahrt. Die
Sitzung selbst – Ihre E-Mail-Adresse, Ihr Name, die Adresse Ihres Bildes und die Kennung Ihres
Kontos bei Google – wird in der Datenbank der Anwendung gespeichert, bis sie endet: wenn Sie sich
abmelden, nach acht Stunden ohne Nutzung und spätestens sieben Tage nach der Anmeldung. Während
der Anmeldung selbst besteht für höchstens zehn Minuten ein zweites Cookie, mit dem geprüft wird,
dass die Antwort von Google zu dieser Anmeldung gehört. Beide sind für den Betrieb der Anwendung
technisch erforderlich, weshalb kein Einwilligungsbanner erscheint (§ 25 Abs. 2 Nr. 2 TDDDG).

Die TaskFest-App kann Sie ohne Cookie angemeldet halten: Nach der Anmeldung erhält sie einen
Zufallswert wie den im Sitzungs-Cookie, der Ihre Sitzung auf dem Server bezeichnet. Die App
bewahrt ihn auf Ihrem Gerät auf und sendet ihn mit jeder Anfrage. Diese Sitzung enthält dasselbe
wie eine Sitzung auf der Website und wird gespeichert, bis sie endet: wenn Sie sich in der App
abmelden oder Ihr Konto löschen, und spätestens 30 Tage nach der Anmeldung. Auch hier werden Ihre
Anmelde-Token nicht aufbewahrt.

Es gibt **keine** Analyse-, Werbe- oder Tracking-Cookies und keinerlei Analyse- oder
Tracking-Skripte.

Die Sprache, die Sie in der Fußzeile wählen, merkt sich Ihr Browser in seinem lokalen Speicher;
sie wird nicht an die Anwendung übertragen.

### Technische Protokolle

Jede Anfrage durchläuft das Content Delivery Network und das API-Gateway von Amazon Web Services
und erreicht die Anwendung. Dabei werden technische Daten erfasst, etwa der Zeitpunkt,
die aufgerufene Adresse, Ihre IP-Adresse, die Kennung Ihres Browsers und ob die Anfrage erfolgreich
war. Das eigene Protokoll der Anwendung wird für `taskfest-qa` 30 Tage und für `taskfest` 90 Tage
aufbewahrt. Es wird zusätzlich an einen Monitoring-Server bei Hetzner gesendet und dort 30 Tage
aufbewahrt;
es enthält Ihre Anmeldekennung, aber weder Ihre IP-Adresse noch die Inhalte Ihrer Aufgaben.

Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO – das berechtigte Interesse, die Anwendung sicher zu
betreiben und Fehlerursachen zu finden.

### Datensicherungen

Für `taskfest` lässt sich die Datenbank auf jeden Zeitpunkt der letzten 35 Tage zurücksetzen;
`taskfest-qa` wird nur gelegentlich von Hand gesichert. Löschen Sie Ihr Konto, wird die Löschung
automatisch auch auf jede später wiederhergestellte Sicherung angewendet, über den unter *Ihre
Rechte* beschriebenen Vermerk. Die Datenbank, die die Anwendung bis November 2026 nutzte, wurde
am 15. November 2026 gelöscht, mit allem, was darin gespeichert war.

### Profilbilder

Ihr Browser lädt Ihr Profilbild direkt von Google. Nur wenn Google keines bereitstellt, sucht die
Anwendung bei **Gravatar** (Automattic Inc., USA) nach einem Bild; Ihr Browser lädt es dann von
Gravatar, das dadurch Ihre IP-Adresse und einen Hashwert Ihrer E-Mail-Adresse erfährt.

### Wie die Anwendung Nutzerdaten von Google verwendet

Von Google erhält die Anwendung nur, was unter *Anmeldung mit Google* aufgeführt ist. Sie
verwendet es, um Sie anzumelden, Ihre Aufgaben Ihnen zuzuordnen und Ihnen anzuzeigen, mit welchem
Konto Sie angemeldet sind; sie gibt es an niemanden weiter außer an die unten genannten
Auftragsverarbeiter und speichert und löscht es, wie diese Erklärung beschreibt. Die Verwendung
von Informationen, die die Anwendung über Google-APIs erhält, entspricht der
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
einschließlich der Anforderungen an die eingeschränkte Nutzung („Limited Use“).

## Wer außerdem Daten erhält

- **Amazon Web Services** (Amazon Web Services EMEA SARL, Luxemburg) betreibt die Anwendung in
  seiner Region Frankfurt. Sein Content Delivery Network beantwortet Anfragen von Standorten
  weltweit.
- **Hetzner** (Hetzner Online GmbH, Gunzenhausen) betreibt in Nürnberg den Monitoring-Server, der
  das Protokoll der Anwendung erhält.
- **Google** (Google Ireland Ltd.) stellt die Anmeldung bereit.
- **Automattic** (Gravatar), wie oben beschrieben, nur wenn Google kein Bild bereitstellt.
- **GitHub** (GitHub Inc., USA) betreibt diese Dokumentationsseite und erhält die technischen
  Daten der Besuche.

Mit Ausnahme von Hetzner haben diese Unternehmen oder ihre Muttergesellschaften ihren Sitz in den
USA. Übermittlungen stützen sich auf den EU-US-Datenschutzrahmen (EU–US Data Privacy Framework),
nach dem sie zertifiziert sind, oder auf die Standardvertragsklauseln der EU.

Nichts wird verkauft, und nichts wird für Werbung oder für automatisierte Entscheidungen über Sie
verwendet.

## Ihre Rechte

Sie haben das Recht auf Auskunft über die zu Ihnen gespeicherten Daten, auf Berichtigung, auf
Löschung, auf Einschränkung der Verarbeitung, auf Datenübertragbarkeit und auf Widerspruch gegen
eine Verarbeitung, die auf berechtigten Interessen beruht (Art. 15–21 DSGVO).

**Um Ihr Konto zu löschen**, wählen Sie oben auf der Übersicht *Konto* → *Konto löschen*. Nach einer
Bestätigung wird Ihr Konto sofort mit allem gelöscht, was es enthält: Ihre E-Mail-Adresse, alle Ihre
Aufgaben und alle Ihre Dateien. Einzige Ausnahme ist eine Datei, die in diesem Moment noch
hochgeladen wurde: Sie kann nach der Löschung ankommen und wird dann innerhalb von sieben Tagen
gelöscht. Danach werden Sie abgemeldet. Melden Sie sich später wieder an, beginnt ein neues, leeres
Konto -- ebenso, wenn Sie eine auf einem anderen Gerät noch offene Sitzung weiter nutzen, die sich
von hier aus nicht beenden lässt. Sie können auch an die oben genannte Adresse schreiben.

**Was eine Löschung hinterlässt:** einen Vermerk, dass das Konto gelöscht wurde, damit die
Löschung auch für eine später wiederhergestellte Datensicherung oder ein Abbild der Datenbank gilt.
Der Vermerk enthält einen SHA-256-Hashwert Ihrer E-Mail-Adresse und den Zeitpunkt der Löschung,
sonst nichts; er liegt bei den Anhängen in Amazon S3 in der AWS-Region Frankfurt. Er enthält Ihre
Adresse nicht, ist aber pseudonym und nicht anonym: Wer Ihre Adresse bereits kennt, kann den
Hashwert berechnen und so sehen, dass ein Konto mit dieser Adresse gelöscht wurde. Er wird
automatisch gelöscht, sobald es keine Sicherung und kein Abbild der Datenbank mehr gibt, das älter
als die Löschung ist, da dann keines das Konto zurückbringen könnte. Rechtsgrundlage: Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit
Art. 17 DSGVO, der Pflicht zur Löschung, die eine wiederhergestellte Sicherung sonst rückgängig
machen würde.

Sie haben außerdem das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren
(Art. 77 DSGVO), zum Beispiel bei der für den Betreiber zuständigen:

Der Landesbeauftragte für den Datenschutz Niedersachsen<br>
Prinzenstraße 5<br>
30159 Hannover

## Änderungen

Diese Erklärung ist Teil der Projektdokumentation und wird öffentlich im Repository geändert. Das
Datum unten ist das der letzten inhaltlichen Änderung.

Stand: 17. November 2026
