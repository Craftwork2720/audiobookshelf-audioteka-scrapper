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
- Intelligent search scoring

## Installation

### Docker compose (Recommended)

```yml
services:
  audiobookshelf-audioteka-scrapper:
    image: ghcr.io/craftwork2720/audiobookshelf-audioteka:latest
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
      - LANGUAGE=pl
      - MAX_RESULTS=15
      - ADD_AUDIOTEKA_LINK_TO_DESCRIPTION=true
    restart: unless-stopped
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