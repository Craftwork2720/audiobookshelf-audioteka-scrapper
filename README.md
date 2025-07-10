# AudioBookshelf Audioteka Scraper

A data scraping provider for AudioBookshelf that fetches audiobook metadata from Audioteka.com (Polish and Czech versions).

## Features

- Search audiobooks by title and author
- Extract comprehensive metadata including:
  - Title, author, narrator, publisher
  - Duration, rating, genres, publication year
  - Cover images and descriptions
  - Direct links to Audioteka
- Support for both Polish (`pl`) and Czech (`cz`) languages
- Intelligent search scoring and duplicate removal
- RESTful API interface compatible with AudioBookshelf

## Installation

### Docker (Recommended)

```bash
docker build -t audioteka-scraper .
docker run -p 3001:3001 -e AUTHORIZATION_TOKEN=your-token audioteka-scraper
```

### Manual Installation

```bash
npm install
npm start
```

## Configuration

Set environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `LANGUAGE` | `pl` | Language (`pl` or `cz`) |
| `MAX_RESULTS` | `15` | Maximum search results |
| `ADD_AUDIOTEKA_LINK_TO_DESCRIPTION` | `true` | Add link to description |
| `AUTHORIZATION_TOKEN` | - | Required API authorization token |

## API Endpoints

### Search Books

```
GET /search?query=book-title&author=author-name&page=1
```

**Headers:**
- `Authorization: Bearer your-token`

**Parameters:**
- `query` (required): Book title to search for
- `author` (optional): Author name to filter by
- `page` (optional): Page number (default: 1)

**Response:**
```json
{
  "matches": [
    {
      "title": "Book Title",
      "author": "Author Name",
      "narrator": "Narrator Name",
      "publisher": "Publisher",
      "publishedYear": "2025",
      "description": "Book description...",
      "cover": "https://cover-url.jpg",
      "genres": ["Genre1", "Genre2"],
      "language": "polish",
      "duration": 480,
      "rating": 4.5,
      "audioTekaLink": "https://audioteka.com/book-url"
    }
  ]
}
```

## Usage with AudioBookshelf

1. Configure this scraper as a metadata provider in AudioBookshelf
2. Set the base URL to your running instance (e.g., `http://localhost:3001`)
3. Add the authorization token in AudioBookshelf settings
4. Use the `/search` endpoint for book lookups

## Development

```bash
# Install dependencies
npm install

# Start in development mode
NODE_ENV=development npm start

# The server will include match scores in responses for debugging
```

## Docker Compose Example

```yaml
version: '3.8'
services:
  audioteka-scraper:
    build: .
    ports:
      - "3001:3001"
    environment:
      - AUTHORIZATION_TOKEN=your-secure-token
      - LANGUAGE=pl
      - MAX_RESULTS=20
    restart: unless-stopped
```

## Search Algorithm

The scraper uses an intelligent scoring system that considers:

- **Exact title matches** (highest priority)
- **Partial title matches** and word-by-word comparison
- **Author matching** when provided
- **Quality indicators** (rating, recency)
- **Duplicate removal** based on normalized titles and authors

## Supported Title Formats

The scraper recognizes various Audioteka title formats:

- `Author - Title (Year) [audiobook PL]`
- `Author - Title [audiobook PL]`
- `Author - Title (Year) [audiobook PL] Superprodukcja`
---

## Integration with Audiobookshelf

To integrate with Audiobookshelf:

1. Go to **Settings** > **Item Metadata Utils** > **Custom Metadata Providers**.
2. Click **Add**.
3. Fill in the following:
   - **Name**: `Audioteka` (or any name)
   - **URL**: `http://<your-ip>:3001`
   - **Authorization Header Value**: Any non-empty string (e.g., `00000`)
4. Click **Save**.

Now, Audiobookshelf will use this service to fetch metadata from Audioteka.