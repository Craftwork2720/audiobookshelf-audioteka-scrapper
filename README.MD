
# audiobookshelf-lubimyczytac-scrapper

A simple web scrapper designed to enrich your [Audiobookshelf](https://www.audiobookshelf.org/) library with metadata from Audioteka (descriptions, authors, cover images, and more).

---

##  Getting Started

You can run the scrapper using **Docker** or **Docker Compose**.

### Docker

```bash
docker run -d \
  --name audiobookshelf-audioteka-scrapper \
  -p 3001:3001 \
  -e PORT=3001 \
  -e LANGUAGE=pl \
  -e MAX_RESULTS=15 \
  -e ADD_AUDIOTEKA_LINK_TO_DESCRIPTION=true \
  ghcr.io/craftwork2720/audiobookshelf-audioteka:latest
```

### Docker Compose

```yaml
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

---

## Configuration

The application is configured using environment variables:

| Variable                          | Description                                 | Default |
|----------------------------------|---------------------------------------------|---------|
| `PORT`                           | Port the app will run on                    | `3001`  |
| `LANGUAGE`                       | Language of results (`pl`, `cz`)                  | `pl`    |
| `MAX_RESULTS`                    | Maximum search results returned             | `15`    |
| `ADD_AUDIOTEKA_LINK_TO_DESCRIPTION` | Add direct Audioteka link to description | `true`  |

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