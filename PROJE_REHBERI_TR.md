# OpenClassTools: Türkçe Proje ve Kullanım Rehberi

## Proje ne yapar?

OpenClassTools, özellikle İngilizce/EFL sınıfları, akıllı tahtalar ve grup etkinlikleri için hazırlanmış tarayıcı tabanlı bir oyun merkezidir. Öğretmen, ders amacına uygun bir oyunu açar; hazır içerik destesini kullanabilir veya konu ve seviyeye göre yapay zekâ ile yeni bir deste oluşturabilir. Oyunlar sınıf ekranında çalışır; oyuncu, takım, skor ve tur bilgileri tarayıcıda yerel olarak tutulur.

Projenin hedefi, öğretmenin kurulum ya da uzaktan kumanda altyapısı gerektirmeden hızlı biçimde sınıf etkinliği başlatabilmesidir. Veritabanı ve isteğe bağlı oturum kaydı kullanılamasa bile oyunların başlangıç içerikleriyle oynanabilmesi amaçlanır.

Tek istisna **Online** kategorisidir: Kahoot tarzı online quiz'de her oyuncu kendi telefonundan katılır. Bu oyun yalnızca Cloudflare Worker yayınında çalışır (aşağıda "Online quiz" bölümü); diğer bütün oyunlar yerel ve bağımsız kalır.

## İçerdiği oyunlar ve araçlar

| Oyun/araç | Kullanım amacı |
| --- | --- |
| LingoParty | Takımların uzay temalı tahtada ilerlediği; dil soruları, şans kartları, dükkân ve final mücadeleleri içeren ana oyun. |
| Who Am I? | Oyuncuların evet/hayır sorularıyla gizli kişiyi tahmin ettiği oyun. |
| Taboo | Hedef kelimeyi, yasaklı kelimeleri kullanmadan anlattıran takım oyunu. |
| Hangman | Harf tahmini ve ipuçlarıyla kelime bulma oyunu. |
| Millionaire | Kolaydan zora 15 soruluk bilgi yarışması; jokerler içerir. |
| Kelime / Word Game | İpuçlarından İngilizce veya Türkçe kelime tahmini. |
| Flashcards | Kelime, anlam ve tekrar çalışması için kartlar. |
| Six Thinking Hats | Altı farklı bakış açısıyla yapılandırılmış sınıf tartışması. |
| Wheel of Names | Öğrenci, konu veya takım seçmek için özelleştirilebilir çark. |
| Spin the Bottle | Sıra belirleme ve rol yapma için şişe çevirme aracı. |
| Online Quiz | Kahoot tarzı bilgi yarışması: yönetici (host) odayı yönetir, oyuncular kendi telefonlarından cevaplar. Yalnızca Cloudflare Worker yayınında çalışır. |

İlk sekiz oyun **deste tabanlıdır**: seçilen soru/kelime seti oyunun içeriğini oluşturur. Çark ve şişe ise desteye gereksinim duymayan yardımcı araçlardır.

## Kullanıcı (öğretmen) olarak nasıl kullanılır?

1. Uygulamayı açın ve oyun merkezinden etkinliği seçin.
2. Deste tabanlı bir oyunda hazır başlangıç destesini veya kayıtlı bir desteyi seçin.
3. Yeni içerik gerekiyorsa oyun ekranındaki deste kütüphanesinde anlamlı bir deste adı girin; konu, CEFR seviyesi ve oyuna özgü seçenekleri belirleyip yapay zekâ ile oluşturun.
4. Takım/oyuncu bilgilerini gerektiğinde girin ve oyunu başlatın. Oyun aktif hâle hemen geçer; isteğe bağlı oturum kaydı arka planda yapılır.
5. Etkinliği sınıf ekranından yönetin. Oyunun puanı, turu ve geçici durumu öğrencilerin cihazlarında değil, açık tarayıcıdaki yerel oyun durumunda yürür.

Önerilen deste adlandırması: `B1 – Travel Vocabulary` veya `A2 – Daily Routines`. Bu, aynı konudaki destelerin yeniden bulunmasını kolaylaştırır.

### Yapay zekâ ile içerik üretimi

Yapay zekâ deste üretimi isteğe bağlıdır. Sunucu tarafında yapılandırılmış sağlayıcı anahtarları varsa platform sağlayıcı havuzu kullanılır. Öğretmen isterse kendi Gemini anahtarını ekleyebilir; bu anahtar yalnızca açık tarayıcı sekmesinin `sessionStorage` alanında tutulur, kalıcı olarak kaydedilmez ve uygulama tarafından loglanmaz.

İstek başarısız olduğunda sistem sırasıyla Gemini, Groq, Kimi/Moonshot ve OpenRouter ücretsiz model seçeneklerine düşebilecek biçimde tasarlanmıştır. Üretim ekranındaki konsol; kullanılan sağlayıcıyı, modeli ve yanıt durumunu gösterir. Çok sık üretim isteği yapılırsa API sınırı devreye girer: istemci başına 15 dakikada en fazla 10 yapay zekâ üretimi.

> Yapay zekâ anahtarı olmadan da başlangıç içerikleriyle oyun oynanabilir. Ancak yeni, kalıcı ve kayıtlı deste üretmek için sunucu sağlayıcıları ve Supabase yapılandırması gerekir.

### LingoParty kısa oyun akışı

LingoParty, çok takımlı bir dil tahtası oyunudur. Takım sırayla çarkı çevirir, tahtada ilerler ve geldiği alanın mücadelesini yapar. Mücadele türleri bilmece, harfleri karıştırılmış kelime, telaffuz, çağrışım, dil bilgisi düzeltme, hız turu, rol yapma ve doğru/yanlış olabilir. Şans alanları ödül/ceza verebilir; dükkândan güçlendirme alınabilir. Daha önce gösterilmiş bir soru tekrar kullanılırsa arayüz bunu `Memory Recall` rozetiyle belirtir.

## Geliştirici için mimari

```text
Tarayıcı
├─ React/Vite: ana oyun merkezi ve LingoParty
├─ Klasik HTML/CSS/JS: diğer oyunlar
└─ platform-client.js / platformApi.js
             │ HTTP /api
             ▼
Express (server.js)
├─ statik dosyaları ve React derlemesini sunar
├─ AI üretim uçları ve sağlayıcı geri dönüş zinciri
├─ deste ve oyun-oturumu HTTP uçları
└─ isteğe bağlı Supabase REST erişimi (yalnızca sunucu)
             │
             ▼
Supabase Postgres
├─ decks ve deck_versions
├─ game_sessions
└─ game_activity_logs
```

- React uygulaması `frontend/` altındadır. Ana merkez `/`, LingoParty ise `/lingoparty` yolundadır.
- Klasik oyunlar kök dizindeki `who.html`, `taboo.html`, `hangman.html` gibi dosyalardır.
- Express sunucusu kökteki `server.js` dosyasıdır; API'leri, güvenlik başlıklarını, istek sınırlarını ve statik dosya sunumunu yürütür.
- `server/` altı deste doğrulama, veri deposu, oturum ve üretim servislerine ayrılmıştır.
- Tarayıcı hiçbir zaman Supabase `service_role` anahtarına doğrudan erişmez.

### Deste ve oturum modeli

Kalıcı depolama etkinse her deste bir oyun türüne bağlı, adlandırılmış ve sürümlenmiş bir içerik kümesidir. `decks` sabit deste kimliğini ve güncel sürümü; `deck_versions` değişmez içerik sürümlerini tutar. Bir oyun oturumu seçilen deste sürümüne bağlanır; sonradan deste yeniden üretilse veya yeniden adlandırılsa eski oturumun içeriği değişmez.

Oturum kaydı isteğe bağlıdır. Başlatma ya da tamamlama kaydı başarısız olsa da oyun akışı kesilmez.

## Yerelde çalıştırma

### Gereksinimler

- Node.js 18 veya üzeri
- Kalıcı desteler ve oturum kayıtları için isteğe bağlı bir Supabase projesi
- Yapay zekâ üretimi için en az bir sağlayıcı anahtarı (Gemini, Groq, Kimi veya OpenRouter)

### Kurulum ve çalıştırma

Proje kökünde aşağıdaki komutları çalıştırın:

```bash
npm install
npm run build
npm start
```

Ardından tarayıcıdan [http://localhost:8090](http://localhost:8090) adresini açın.

`npm start`, Express sunucusunu çalıştırır. `npm run build`, React/Vite uygulamasını `frontend/dist` dizinine üretir; Express bu derlemeyi ve klasik oyun dosyalarını aynı porttan sunar.

### React arayüzünü geliştirme modunda çalıştırma

İki ayrı terminal kullanın:

```bash
# Terminal 1: API ve klasik oyunlar
npm start

# Terminal 2: React/Vite geliştirme sunucusu
npm --prefix frontend run dev
```

React geliştirme arayüzü varsayılan olarak `http://localhost:5173` adresindedir. Vite, `/api` isteklerini otomatik olarak `http://localhost:8090` adresindeki Express sunucusuna yönlendirir.

## Ortam değişkenleri

Kökte `.env.example` dosyasını `.env` olarak kopyalayıp gerekli değerleri girin:

```env
PORT=8090
GEMINI_API_KEY=...
GROQ_API_KEY=...
KIMI_API_KEY=...
OPENROUTER_API_KEY=...
SUPABASE_URL=https://proje.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

- `PORT`: Sunucunun dinleyeceği port; varsayılanı `8090`.
- AI anahtarları: Deste üretimi için kullanılır. Birden fazla anahtar, kesinti durumunda geri dönüş zinciri sağlar.
- `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY`: Kalıcı desteler ve oturumlar için sunucu tarafı kimlik bilgileri. Service-role anahtarı gizlidir; istemci koduna eklenmemeli veya Git'e gönderilmemelidir.

Supabase kurulacaksa önce [migrasyon dosyasını](../supabase/migrations/20260725130600_persistent_platform_foundation.sql) uygulayın, ardından başlangıç destelerini kaydedin:

```bash
npm run seed:decks
```

Bu tohumlama işlemi tekrar çalıştırılabilir; mevcut adlandırılmış desteleri ve sürümlerini ezmez.

## Statik site olarak yayınlama (Cloudflare Workers Static Assets)

Proje, Express/Supabase backend'i olmadan da statik bir site olarak yayınlanabilir. Yayın tek bir Cloudflare Worker'dır (`rohirrimgames`): her şey statik dosya olarak sunulur; Worker kodu yalnızca `/rt/*` yolları (online quiz uçları ve `QuizRoom` Durable Object'i) için çalışır. Bu modda yapay zekâ ile deste üretimi ve oturum kaydı çalışmaz; her deste tabanlı oyun bunun yerine kendi gömülü **statik desteleri** arasından seçim yapılan bir "Deck" açılır menüsü gösterir. Canlı örnek: [games.ortadunyaankara.org](https://games.ortadunyaankara.org).

Barındırma **Cloudflare Workers Static Assets** üzerinden yapılır (eskiden Cloudflare Pages kullanılıyordu; proje `rohirrim-ankara-smiali` kardeş projesiyle aynı yapıya taşındı). Deploy, Cloudflare'in kendi Git entegrasyonu (Workers Builds) ile yönetilir: repo Cloudflare hesabına bağlıdır, `main`'e her push otomatik olarak yeni bir build+deploy tetikler. Ayrı bir GitHub Actions workflow'u **yoktur**.

### Nasıl çalışır?

- `wrangler.jsonc`, `main`'i `worker/index.js`'e, `assets.run_worker_first`'ü `["/rt/*"]`'e ayarlar ve `QUIZ_ROOMS` Durable Object bağlamasını (`QuizRoom` sınıfı) tanımlar; `/rt/*` dışındaki her istek doğrudan statik dosya katmanından yanıtlanır. Kendi uçlarımız `/rt/` altındadır, **asla** `/api/` altında değil — aşağıdaki gerçek 404 davranışı buna dayanır.
- `wrangler.jsonc`, `assets.directory`'yi `./dist-static`'e, `assets.not_found_handling`'i `"404-page"`e ayarlar. Bu, eşleşmeyen her yolu (`/api/*` dahil) gerçek bir `404` durum koduyla (ama `dist-static/404.html` içeriğiyle) yanıtlamayı Workers'a native olarak yaptırır — Pages döneminde elle yapılan "index.html'i 404.html'e kopyala" hilesiyle aynı sonucu, platform desteğiyle sağlar.
- Her oyun sayfası açılışta `/api/health` (ya da ilgili `/api/decks` ucu) ile backend'e ulaşmaya çalışır. Ulaşamazsa (statik barındırmada normal olan durum budur, çünkü `/api/*` gerçek 404 döner) yapay zekâ girdi alanlarını ve kayıtlı-deste seçiciyi gizler, yerine `#static-deck-wrap` içindeki basit bir `<select>` menüsünü gösterir.
- Bu menüdeki seçenekler, ilgili oyunun `.js` dosyasında tanımlı `STATIC_DECKS` dizisinden gelir (örn. `who` için `game.js`, `hangman` için `hangman.js`). Her oyunda en az bir "Starter — General" destesi ve genelde oyunun kendi gömülü varsayılan içeriği (`DEFAULT_*`) bulunur.
- `scripts/build-pages-site.mjs` (isim tarihsel, hâlâ kullanılıyor), yalnızca statik barındırma için gereken dosyaları (`index.html`, oyun `.html/.css/.js` dosyaları, `shared/`, ikonlar vb.) `dist-static/` klasörüne toplar ve `index.html`'i `dist-static/404.html` olarak da kopyalar; `server.js`, `server/`, `supabase/`, `tests/`, `frontend/` gibi backend'e özgü klasörler dahil edilmez. `wrangler.jsonc`'daki `build.command` bu script'i her deploy'da otomatik çalıştırır.

### Statik build'i üretme (yerel önizleme)

```bash
node scripts/build-pages-site.mjs
```

Çıktı `dist-static/` klasöründe oluşur; `npx serve dist-static` gibi herhangi bir statik dosya sunucusuyla yerelde önizlenebilir.

### Manuel deploy (tek seferlik veya acil durum)

```bash
npx wrangler login
npx wrangler deploy
```

`wrangler.jsonc`'daki `build.command` ve `assets.directory` ayarları sayesinde build otomatik yapılır. Normal akışta buna gerek yoktur — `main`'e push yeterlidir.

> **Canlı oyun sırasında deploy yok.** `main`'e her push bir deploy'dur; deploy tüm Durable Object'leri yeniden başlatır ve açık bütün WebSocket bağlantılarını koparır. Oda durumu korunur ve istemciler yeniden bağlanır, ama oyun herkes için kesintiye uğrar. Online quiz etkinliği sürerken push/merge yapmayın.

### Cloudflare Git entegrasyonu ve custom domain

Repo, Cloudflare dashboard → Workers & Pages → Create → **Connect to Git** akışıyla `ridvankuntug/rohirrimgames`'e bağlanmıştır (GitHub App yetkilendirmesi tek seferlik). Özel alan adı, Workers projesinin **Domains** sekmesinden ya da doğrudan API ile eklenir:

```bash
curl -X PUT -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"environment":"production","hostname":"<altalan>","service":"rohirrimgames","zone_id":"<zone-id>"}' \
  "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/domains"
```

Zone aynı Cloudflare hesabındaysa gerekli DNS kaydı (AAAA, proxied) otomatik oluşturulur — elle CNAME eklemeye gerek yoktur (bu, eski Pages custom-domain akışından farkıdır).

### Tema ve renk şeması

Görsel kimlik `theme.css`, `hub.css`, `style.css` ve her oyunun kendi `.css` dosyasındaki `:root` değişkenleriyle (`--bg-dark`, `--accent-1/2/3`, `--glass-bg`, `--glass-border`, `--text-primary/secondary`) belirlenir. Farklı bir renk şemasına geçmek için bu değişkenleri (ve varsa aynı tonların ham `rgba()`/hex hâllerini) tüm dosyalarda tutarlı şekilde güncellemek yeterlidir. Fonksiyonel/anlamsal renkler (doğru/yanlış geri bildirimi, Six Thinking Hats şapka renkleri, LingoParty kategori rozetleri) kasıtlı olarak değiştirilmeden bırakılmalıdır.

## Online quiz

Kahoot tarzı online quiz `/quiz` adresindedir ve oyun merkezinin **Online** sekmesinde görünür. Oyun kuralları `shared/quiz-engine.js` içindeki saf motordadır; her oda bir `QuizRoom` Durable Object'idir ve tarayıcılarla WebSocket üzerinden konuşur. Express sunucusunda (`npm start`) `/rt/*` uçları yoktur; orada Online kartı "çevrimdışı" görünür. Tasarım ve kararlar: [docs/superpowers/specs/2026-10-04-online-quiz-design.md](docs/superpowers/specs/2026-10-04-online-quiz-design.md).

### Kısa kullanım

1. **Yönetici (host)**: `/quiz` sayfasını açar, Turnstile doğrulamasından geçip oda oluşturur; lobide deste ve ayarları seçer.
2. **Oyuncular**: `/quiz#join=<KOD>` bağlantısı, QR kod ya da `/quiz` sayfasına 6 karakterlik oda kodunu yazarak katılır ve bir takma ad seçer (bir cihaz = bir oyuncu).
3. Yönetici oyunu başlatır; her sorunun sonucundan sonra **Sonraki soru** ile devam eder. Bağlantısı kopan oyuncunun puanı korunur, geri dönebilir.
4. **Yönetici linkini kopyala** (`/quiz#host=…`) odanın yönetimini başka bir cihazda geri almayı sağlar. **Bu bağlantı odanın tam yetkisini verir; kimseyle paylaşmayın.**

### Operatör kurulumu (bir kez)

1. Cloudflare panosu → **Turnstile** → `games.ortadunyaankara.org` için bir widget ekleyin (mod: Managed).
2. **Site Key** herkese açıktır ve `frontend/src/config/quizConfig.js` içinde durur.
3. **Secret Key**, `TURNSTILE_SECRET_KEY` adlı bir Worker secret'ıdır: Workers & Pages → `rohirrimgames` → Settings → Variables and Secrets ya da `npx wrangler secret put TURNSTILE_SECRET_KEY`. Repoya, herhangi bir dosyaya veya sohbete **asla** yazılmaz. Secret yoksa oda oluşturma reddedilir (`503 turnstile_not_configured`).

### Yerel geliştirme

```bash
cp .dev.vars.example .dev.vars    # git'e girmez; yalnızca Cloudflare'in her zaman geçen TEST secret'ı
node scripts/build-pages-site.mjs
npx wrangler dev
```

`wrangler dev`'in verdiği adreste `/quiz`'i açın; üretim dışı adreslerde ön yüz Cloudflare'in test site key'ini kullanır. Windows'ta `wrangler dev` açıkken `node scripts/build-pages-site.mjs` `EBUSY` hatası verir (`dist-static/` kilitli); önce `wrangler dev`'i durdurun. Dosya haritası ve kurallar: `AGENTS.md` → "Online games (quiz)".

## Kontrol ve test

```bash
npm test
npm --prefix frontend run lint
npm --prefix frontend run build
```

Sunucunun ayakta olduğunu denetlemek için:

```bash
curl http://localhost:8090/api/health
```

## Sık karşılaşılan durumlar

| Belirti | Açıklama / çözüm |
| --- | --- |
| Ana merkez açılmıyor veya `/lingoparty` 404 dönüyor | Önce `npm run build` çalıştırın, sonra `npm start` ile sunucuyu yeniden başlatın. |
| Yapay zekâ üretimi başarısız | `.env` içindeki sağlayıcı anahtarını ve kotasını kontrol edin. Öğretmen anahtarı başarısız olursa uygulama sunucu havuzuna dönmeyi dener. |
| Kayıtlı deste listesi boş ya da yüklenmiyor | Supabase ortam değişkenlerini, migrasyonu ve `npm run seed:decks` adımını doğrulayın. Oyunların yerleşik başlangıç içerikleri yine kullanılabilir. |
| Oturum kaydı hatası | Bu özellik isteğe bağlıdır; oyun oynamayı engellemez. Supabase yapılandırmasını kontrol edin. |
| Çok sayıda üretimden sonra 429 hatası | 15 dakikalık üretim penceresinin yenilenmesini bekleyin. |

## İlgili dosyalar

- [Ana sunucu](../server.js)
- [React ana uygulaması](../frontend/src/App.jsx)
- [Oyun merkezi](../frontend/src/components/Hub/GameHub.jsx)
- [Deste/oturum veritabanı notları](database.md)
- [Dağıtım notları](../DEPLOY.md)
