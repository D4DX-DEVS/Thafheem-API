# Thafheem Quran API

Backend API for Thafheem Quran Web Application - providing translations, interpretations, and word-by-word meanings in multiple languages.

## 🚀 Quick Start

### Installation

```bash
# Install dependencies
npm install

# Start development server (with auto-reload)
npm run dev

# Start production server
npm start
```

### Environment Variables

Create a `.env` file in the root directory:

```env
PORT=5000
NODE_ENV=development
DB_PATH=./db
FRONTEND_URL=http://localhost:5173
```

## 📚 API Endpoints

### Base URL
```
http://localhost:5000/api
```

### Supported Languages
- `bangla` - Bengali/Bangla
- `hindi` - Hindi
- `tamil` - Tamil
- `urdu` - Urdu

---

## 🔍 Endpoints

### 1. Get Translation

Get translation for a specific ayah.

```
GET /api/:language/translation/:surah/:ayah
```

**Example:**
```bash
GET /api/bangla/translation/1/1
```

**Response:**
```json
{
  "language": "bangla",
  "surah": 1,
  "ayah": 1,
  "translation_text": "পরম করুণাময় অসীম দয়ালু আল্লাহর নামে।"
}
```

---

### 2. Get Surah Translations

Get all translations for a complete surah.

```
GET /api/:language/surah/:surah
```

**Example:**
```bash
GET /api/hindi/surah/1
```

**Response:**
```json
{
  "language": "hindi",
  "surah": 1,
  "count": 7,
  "translations": [
    {
      "verse_number": 1,
      "translation_text": "अल्लाह के नाम से जो बड़ा कृपाशील और अत्यन्त दयावान है।"
    },
    ...
  ]
}
```

---

### 3. Get Interpretation/Explanation

Get interpretation/explanation for a specific ayah.

```
GET /api/:language/interpretation/:surah/:ayah
```

**Query Parameters:**
- `explanationNo` (optional) - Get specific explanation by number

**Example:**
```bash
GET /api/bangla/interpretation/1/1
GET /api/hindi/interpretation/2/5?explanationNo=1
```

**Response:**
```json
{
  "language": "bangla",
  "surah": 1,
  "ayah": 1,
  "count": 2,
  "explanations": [
    {
      "explanation": "ব্যাখ্যা টেক্সট...",
      "explanation_no_local": "১",
      "explanation_no_en": 1
    }
  ]
}
```

**Note:** 
- Tamil does not have interpretations available
- Urdu uses footnote system (see Urdu Footnote endpoint)

---

### 4. Get Word-by-Word Translation

Get word-by-word breakdown for a specific ayah.

```
GET /api/:language/word-by-word/:surah/:ayah
```

**Example:**
```bash
GET /api/tamil/word-by-word/1/1
```

**Response:**
```json
{
  "language": "tamil",
  "surah": 1,
  "ayah": 1,
  "count": 4,
  "words": [
    {
      "WordId": 1,
      "SuraId": 1,
      "AyaId": 1,
      "WordPhrase": "பிஸ்மில்லாஹ்",
      "WordMeaning": "அல்லாஹ்வின் பெயரால்"
    },
    ...
  ]
}
```

---

### 5. Get Urdu Footnote (Special)

Get Urdu footnote/explanation by footnote ID.

```
GET /api/urdu/footnote/:footnoteId
```

**Example:**
```bash
GET /api/urdu/footnote/123
```

**Response:**
```json
{
  "footnote_id": 123,
  "footnote_text": "فٹ نوٹ کی تفصیل..."
}
```

---

### 6. Language Health Check

Check if a specific language database is connected and working.

```
GET /api/:language/health
```

**Example:**
```bash
GET /api/bangla/health
```

**Response:**
```json
{
  "language": "bangla",
  "status": "ok",
  "message": "Bangla database is connected and working"
}
```

---

## 📊 Database Structure

### Bangla Database
- **Tables:** `bangla_translations`, `bengla_explanations`, `bengla_wordmeanings`
- **Features:** Translation ✅, Interpretation ✅, Word-by-Word ✅

### Hindi Database
- **Tables:** `hindi_translation`, `hindi_explanation`, `hindi_wordmeanings`
- **Features:** Translation ✅, Interpretation ✅, Word-by-Word ✅

### Tamil Database
- **Tables:** `tamil_translations`, `tamil_wordmeanings`
- **Features:** Translation ✅, Interpretation ❌, Word-by-Word ✅

### Urdu Database
- **Tables:** `urdu_tranlations`, `urdu_footnotes`, `urdu_wordmeanings`
- **Features:** Translation ✅, Footnotes ✅, Word-by-Word ✅
- **Note:** Uses footnote system instead of direct interpretations

---

## 🛠️ Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (invalid language, invalid parameters)
- `404` - Not Found (translation not found, endpoint not found)
- `500` - Internal Server Error (database error)

---

## 🧪 Testing

Test the API using curl, Postman, or your browser:

```bash
# Health check
curl http://localhost:5000/health

# Get Bangla translation
curl http://localhost:5000/api/bangla/translation/1/1

# Get Hindi interpretation
curl http://localhost:5000/api/hindi/interpretation/2/5

# Get Tamil surah
curl http://localhost:5000/api/tamil/surah/1
```

---

## 📁 Project Structure

```
Thafheem-API/
├── config/
│   └── database.js          # Database connections
├── controllers/
│   └── translationController.js  # Request handlers
├── middlewares/
│   ├── errorHandler.js      # Error handling
│   └── logger.js            # Request logging
├── routes/
│   └── apiRoutes.js         # API route definitions
├── db/
│   ├── quran_bangla.db
│   ├── quran_hindi.db
│   ├── quran_tamil.db
│   └── quran_urdu.db
├── .env                     # Environment variables
├── .gitignore
├── package.json
├── server.js                # Main server file
└── README.md
```

---

## 🔧 Development

```bash
# Install dependencies
npm install

# Run in development mode (auto-reload)
npm run dev

# Run in production mode
npm start
```

---

## 📝 License

ISC

---

## 👨‍💻 Author

Thafheem Development Team

