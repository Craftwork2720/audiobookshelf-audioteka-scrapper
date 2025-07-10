const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

function cleanCoverUrl(url) {
  return url ? url.split('?')[0] : url;
}

function parseDuration(durationStr) {
  if (!durationStr) return undefined;
  
  const match = durationStr.match(/(?:(\d+)\s*(?:godz|h|hrs?)\.?)?\s*(?:(\d+)\s*(?:min|m)\.?)?/i);
  if (!match) return undefined;
  
  const hours = parseInt(match[1] || 0, 10);
  const minutes = parseInt(match[2] || 0, 10);
  return hours * 60 + minutes;
}

function normalize(str) {
  return str.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleComponents(title) {
  // Handle titles with or without year, with optional "Superprodukcja" suffix
  const patterns = [
    /^(.*?)\s+-\s+(.*?)\s*\((\d{4})\)\s*\[audiobook PL\](?:\s+Superprodukcja)?$/i,
    /^(.*?)\s+-\s+(.*?)\s*\[audiobook PL\](?:\s+Superprodukcja)?$/i
  ];
  
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      return {
        authors: match[1].split(/\s*,\s*|\s+i\s+|\s+oraz\s+/i),
        cleanTitle: match[2],
        year: match[3] ? parseInt(match[3], 10) : null
      };
    }
  }
  
  return null;
}

function calculateScore(book, query, author) {
  const normQuery = normalize(query);
  const normAuthor = normalize(author || '');
  const normTitle = normalize(book.cleanTitle || book.title);
  const normBookAuthors = book.authors.map(a => normalize(a));
  
  let score = 0;
  
  // Exact title match
  if (normTitle === normQuery) return 95;
  
  // Partial title match - check if query contains title or vice versa
  if (normTitle.includes(normQuery) || normQuery.includes(normTitle)) {
    score += 80;
  }
  
  // Word-by-word matching for title
  const titleWords = normQuery.split(/\s+/).filter(word => word.length > 1);
  const titleMatches = titleWords.filter(word => normTitle.includes(word)).length;
  if (titleWords.length > 0) {
    score += (titleMatches / titleWords.length) * 60;
  }
  
  // Author matching
  if (normAuthor) {
    const authorMatch = normBookAuthors.some(bookAuthor => 
      bookAuthor.includes(normAuthor) || normAuthor.includes(bookAuthor)
    );
    if (authorMatch) score += 25;
  }
  
  // Quality bonus
  if (book.rating >= 4.5) score += 10;
  else if (book.rating >= 4.0) score += 5;
  
  // Recency bonus for new releases
  const currentYear = new Date().getFullYear();
  if (book.year === currentYear) score += 5;
  
  return Math.min(score, 100);
}

function removeDuplicates(matches) {
  const seen = new Set();
  return matches.filter(match => {
    const key = `${normalize(match.cleanTitle || match.title)}|${normalize(match.authors[0] || '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use((req, res, next) => {
  const apiKey = req.headers['authorization'];
  if (!apiKey) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

const language = process.env.LANGUAGE || 'pl';
const addAudiotekaLinkToDescription = (process.env.ADD_AUDIOTEKA_LINK_TO_DESCRIPTION || 'true').toLowerCase() === 'true';
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS) || 15;

class AudiotekaProvider {
  constructor() {
    this.id = 'audioteka';
    this.name = 'Audioteka';
    this.baseUrl = 'https://audioteka.com';
    this.searchUrl = language === 'cz' 
      ? 'https://audioteka.com/cz/vyhledavani' 
      : 'https://audioteka.com/pl/szukaj';
  }

  async searchBooks(query, author = '', page = 1) {
    try {
      const searchUrl = `${this.searchUrl}?phrase=${encodeURIComponent(query)}&page=${page}`;
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': language === 'cz' ? 'cs-CZ' : 'pl-PL'
        }
      });
      
      const $ = cheerio.load(response.data);
      const matches = [];
      
      $('.adtk-item.teaser_teaser__FDajW').each((index, element) => {
        const $book = $(element);
        const title = $book.find('.teaser_title__hDeCG').text().trim();
        const bookUrl = this.baseUrl + $book.find('.teaser_link__fxVFQ').attr('href');
        const authors = [$book.find('.teaser_author__LWTRi').text().trim()];
        const cover = cleanCoverUrl($book.find('.teaser_coverImage__YMrBt').attr('src'));
        const rating = parseFloat($book.find('.teaser-footer_rating__TeVOA').text().trim()) || null;
        const id = $book.attr('data-item-id') || bookUrl.split('/').pop();

        if (title && bookUrl && authors[0]) {
          matches.push({ id, title, authors, url: bookUrl, cover, rating });
        }
      });

      const hasMore = $('a[aria-label="Next"]').length > 0;
      return { matches, hasMore };
    } catch (error) {
      console.error('Search error:', error.message);
      return { matches: [], hasMore: false };
    }
  }

  async getFullMetadata(match) {
    try {
      const response = await axios.get(match.url);
      const $ = cheerio.load(response.data);

      const isCzech = language === 'cz';
      
      // Extract metadata
      const narrators = $(isCzech ? 'dt:contains("Interpret")' : 'dt:contains("Głosy")')
        .next('dd').find('a').map((i, el) => $(el).text().trim()).get().join(', ');
      
      const durationStr = $(isCzech ? 'dt:contains("Délka")' : 'dt:contains("Długość")')
        .next('dd').text().trim();
      const duration = parseDuration(durationStr);
      
      const publisher = $(isCzech ? 'dt:contains("Vydavatel")' : 'dt:contains("Wydawca")')
        .next('dd').find('a').first().text().trim();
      
      const genres = $(isCzech ? 'dt:contains("Kategorie")' : 'dt:contains("Kategoria")')
        .next('dd').find('a').map((i, el) => $(el).text().trim()).get();
      
      const ratingText = $('.star-icon_label__wbNAx').text().trim();
      const rating = ratingText ? parseFloat(ratingText.replace(',', '.')) : null;
      
      let description = $('.description_description__6gcfq').html() || 
                      $('.description_description__6gcfq').text().trim();
      
      if (addAudiotekaLinkToDescription) {
        const audioTekaLink = `<a href="${match.url}">Audioteka link</a>`;
        description = description ? `${audioTekaLink}\n\n${description}` : audioTekaLink;
      }
      
      const cover = cleanCoverUrl($('.product-top_cover__Pth8B').attr('src') || match.cover);
      
      const yearMatch = $('dt:contains("Rok vydání"), dt:contains("Rok wydania")')
        .next('dd').text().trim();
      const publishedYear = yearMatch ? parseInt(yearMatch, 10) : null;
      
      const titleComponents = extractTitleComponents(match.title) || {
        authors: match.authors,
        cleanTitle: match.title,
        year: publishedYear
      };

      return {
        ...match,
        ...titleComponents,
        cover,
        narrator: narrators,
        duration,
        publisher,
        description,
        genres,
        rating,
        publishedYear: titleComponents.year,
        identifiers: { audioteka: match.id },
        languages: [isCzech ? 'czech' : 'polish']
      };
    } catch(error) {
      console.error(`Metadata error for ${match.title}:`, error.message);
      return match;
    }
  }
}

const provider = new AudiotekaProvider();

app.get('/search', async (req, res) => {
  try {
    const { query, author = '', page = 1 } = req.query;
    if (!query) return res.status(400).json({ error: 'Query parameter is required' });

    console.log(`Searching for: "${query}" by "${author}"`);

    // Search multiple pages
    let allMatches = [];
    let currentPage = parseInt(page);
    let hasMore = true;
    let pageCount = 0;

    while (hasMore && allMatches.length < MAX_RESULTS * 2 && pageCount < 3) {
      const { matches, hasMore: more } = await provider.searchBooks(query, author, currentPage);
      allMatches = [...allMatches, ...matches];
      hasMore = more && matches.length > 0;
      currentPage++;
      pageCount++;
    }

    console.log(`Found ${allMatches.length} matches`);

    // Remove duplicates and score results
    const uniqueMatches = removeDuplicates(allMatches);
    const scoredMatches = uniqueMatches.map(book => {
      const components = extractTitleComponents(book.title) || {
        authors: book.authors,
        cleanTitle: book.title,
        year: new Date().getFullYear()
      };
      const bookWithComponents = { ...book, ...components };
      const score = calculateScore(bookWithComponents, query, author);
      
      return { ...bookWithComponents, score };
    });

    // Sort by score and take top results
    const topMatches = scoredMatches
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);

    // Get full metadata
    const fullMetadata = await Promise.all(
      topMatches.map(async (match) => {
        const metadata = await provider.getFullMetadata(match);
        return { ...metadata, score: match.score };
      })
    );

    console.log(`Returning ${fullMetadata.length} results`);

    // Format response
    res.json({
      matches: fullMetadata.map(book => ({
        title: book.cleanTitle || book.title,
        author: book.authors.join(', '),
        narrator: book.narrator || undefined,
        publisher: book.publisher || undefined,
        publishedYear: book.publishedYear?.toString(),
        description: book.description || undefined,
        cover: book.cover || undefined,
        genres: book.genres || undefined,
        language: book.languages[0],
        duration: book.duration,
        rating: book.rating,
        audioTekaLink: book.url,
        matchScore: process.env.NODE_ENV === 'development' ? book.score.toFixed(2) : undefined
      }))
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Audioteka provider listening on port ${port}, language: ${language}`);
});