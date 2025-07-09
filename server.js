const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

function cleanCoverUrl(url) {
  if (url) {
    return url.split('?')[0];
  }
  return url;
}

function parseDuration(durationStr) {
  if (!durationStr) return undefined;

  let hours = 0;
  let minutes = 0;

  const durationRegex = /^(?:(\d+)\s+[^\d\s]+)?\s*(?:(\d+)\s+[^\d\s]+)$/; 
  const matches = durationStr.match(durationRegex);

  if (matches) { 
    if (matches[1]) {
      hours = parseInt(matches[1], 10);
    }
    if (matches[2]) { 
      minutes = parseInt(matches[2], 10);
    }
  } else {
      if (durationStr.trim()) {
        console.warn(`Could not parse duration string using provided regex: "${durationStr}"`);
      }
      return undefined;
  }

  if (isNaN(hours)) hours = 0;
  if (isNaN(minutes)) minutes = 0;

  const durationInMinutes = (hours * 60) + minutes;
  console.log(`Parsed duration in minutes for "${durationStr}": ${durationInMinutes}`);
  return durationInMinutes;
}

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());

// Middleware to check for AUTHORIZATION header
app.use((req, res, next) => {
  const apiKey = req.headers['authorization'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // part to validate API
  next();
});

const language = process.env.LANGUAGE || 'pl';  // Default to Polish if not specified
const addAudiotekaLinkToDescription = (process.env.ADD_AUDIOTEKA_LINK_TO_DESCRIPTION || 'true').toLowerCase() === 'true';

class AudiotekaProvider {
  constructor() {
    this.id = 'audioteka';
    this.name = 'Audioteka';
    this.baseUrl = 'https://audioteka.com';
    this.searchUrl = language === 'cz' ? 'https://audioteka.com/cz/vyhledavani' : 'https://audioteka.com/pl/szukaj';
  }

  async searchBooks(query, author = '') {
    try {
      console.log(`Searching for: "${query}" by "${author}"`);
      const searchUrl = `${this.searchUrl}?phrase=${encodeURIComponent(query)}`;
      
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept-Language': language === 'cz' ? 'cs-CZ' : 'pl-PL'
        }
      });
      const $ = cheerio.load(response.data);

      console.log('Search URL:', searchUrl);

      const matches = [];
      const $books = $('.adtk-item.teaser_teaser__FDajW');
      console.log('Number of books found:', $books.length);

      $books.each((index, element) => {
        const $book = $(element);
        
        const title = $book.find('.teaser_title__hDeCG').text().trim();
        const bookUrl = this.baseUrl + $book.find('.teaser_link__fxVFQ').attr('href');
        const authors = [$book.find('.teaser_author__LWTRi').text().trim()];
        const cover = cleanCoverUrl($book.find('.teaser_coverImage__YMrBt').attr('src'));
        const rating = parseFloat($book.find('.teaser-footer_rating__TeVOA').text().trim()) || null;

        const id = $book.attr('data-item-id') || bookUrl.split('/').pop();

        if (title && bookUrl && authors.length > 0) {
          matches.push({
            id,
            title,
            authors,
            url: bookUrl,
            cover,
            rating,
            source: {
              id: this.id,
              description: this.name,
              link: this.baseUrl,
            },
          });
        }
      });

      const fullMetadata = await Promise.all(matches.map(match => this.getFullMetadata(match)));
      return { matches: fullMetadata };
    } catch (error) {
      console.error('Error searching books:', error.message, error.stack);
      return { matches: [] };
    }
  }

  async getFullMetadata(match) {
    try {
      console.log(`Fetching full metadata for: ${match.title}`);
      const response = await axios.get(match.url);
      const $ = cheerio.load(response.data);

      // Get narrator from the "Głosy" section using new selector
      const narrators = language === 'cz' 
        ? $('dt:contains("Interpret")').next('dd').find('a').map((i, el) => $(el).text().trim()).get().join(', ')
        : $('dt:contains("Głosy")').next('dd').find('a').map((i, el) => $(el).text().trim()).get().join(', ');

      // Get duration from the "Długość" section using new selector
      const durationStr = language === 'cz'
        ? $('dt:contains("Délka")').next('dd').text().trim()
        : $('dt:contains("Długość")').next('dd').text().trim();

      console.log(`Extracted duration string for ${match.title}: "${durationStr}"`); 

      const durationInMinutes = parseDuration(durationStr);

      // Get publisher from the "Wydawca" section using new selector
      const publisher = language === 'cz'  
        ? $('dt:contains("Vydavatel")').next('dd').find('a').first().text().trim()
        : $('dt:contains("Wydawca")').next('dd').find('a').first().text().trim();

      // Get type using new selector
      const type = $('dt:contains("Typ")').next('dd').text().trim();

      // Get categories/genres using new selector
      const genres = language === 'cz'
        ? $('dt:contains("Kategorie")').next('dd').find('a').map((i, el) => $(el).text().trim()).get()
        : $('dt:contains("Kategoria")').next('dd').find('a').map((i, el) => $(el).text().trim()).get();

      // Get series information
      const series = $('.collections_list__09q3I li a')
        .map((i, el) => $(el).text().trim())
        .get();

      // Get rating with new selector
      const ratingText = $('.star-icon_label__wbNAx').text().trim();
      const rating = ratingText ? parseFloat(ratingText.replace(',', '.')) : null;
      
      // Get description with HTML
      const descriptionHtml = $('.description_description__6gcfq').html();
      
      // Basic sanitization
      let sanitizedDescription = '';
      if (descriptionHtml) {
        sanitizedDescription = descriptionHtml
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
      }

      let description = sanitizedDescription;
      if (addAudiotekaLinkToDescription) {
        const audioTekaLink = `<a href="${match.url}">Audioteka link</a>`;
        description = `${audioTekaLink}<br><br>${sanitizedDescription}`;
        console.log(`Audioteka link will be added to the description for ${match.title}`);
      }

      // Get main cover image and clean the URL
      const cover = cleanCoverUrl($('.product-top_cover__Pth8B').attr('src') || match.cover);

      const languages = language === 'cz' 
        ? ['czech'] 
        : ['polish'];

      const fullMetadata = {
        ...match,
        cover,
        narrator: narrators,
        duration: durationInMinutes,
        publisher,
        description,
        type,
        genres,
        series: [],
        tags: series,
        rating,
        languages, 
        identifiers: {
          audioteka: match.id,
        },
      };

      console.log(`Full metadata for ${match.title}:`, JSON.stringify(fullMetadata, null, 2));
      return fullMetadata;
    } catch (error) {
      console.error(`Error fetching full metadata for ${match.title}:`, error.message, error.stack);
      return match;
    }
  }
}

const provider = new AudiotekaProvider();

app.get('/search', async (req, res) => {
  try {
    console.log('Received search request:', req.query);
    const query = req.query.query;
    const author = req.query.author;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const results = await provider.searchBooks(query, author);
    
    // Format the response according to the OpenAPI specification
    const formattedResults = {
      matches: results.matches.map(book => ({
        title: book.title,
        subtitle: book.subtitle || undefined,
        author: book.authors.join(', '),
        narrator: book.narrator || undefined,
        publisher: book.publisher || undefined,
        publishedYear: book.publishedDate ? new Date(book.publishedDate).getFullYear().toString() : undefined,
        description: book.description || undefined,
        cover: book.cover || undefined,
        isbn: book.identifiers?.isbn || undefined,
        asin: book.identifiers?.asin || undefined,
        genres: book.genres || undefined,
        tags: book.tags || undefined,
        series: book.series ? book.series.map(seriesName => ({
          series: seriesName,
          sequence: undefined
        })) : undefined,
        language: book.languages && book.languages.length > 0 ? book.languages[0] : undefined,
        duration: book.duration
      }))
    };

    console.log('Sending response:', JSON.stringify(formattedResults, null, 2));
    res.json(formattedResults);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Audioteka provider listening on port ${port}, language: ${language}, add link to description: ${addAudiotekaLinkToDescription}`);
});