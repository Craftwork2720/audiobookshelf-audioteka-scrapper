const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

function cleanCoverUrl(url) {
  return url ? url.split('?')[0] : url;
}

function parseDuration(durationStr) {
  if (!durationStr) return undefined;

  const regexPatterns = [
    /(?:(\d+)\s*godz\.|hrs?\.?)?\s*(?:(\d+)\s*min\.?)?/i,
    /(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:inutes?)?)?/i
  ];

  for (const pattern of regexPatterns) {
    const matches = durationStr.match(pattern);
    if (matches) {
      const hours = parseInt(matches[1] || 0, 10);
      const minutes = parseInt(matches[2] || 0, 10);
      return hours * 60 + minutes;
    }
  }

  if (durationStr.trim()) {
    console.warn(`Could not parse duration: "${durationStr}"`);
  }
  return undefined;
}

function normalizeString(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleComponents(title) {
  const pattern = /^(.*?)\s+-\s+(.*?)\s*\((\d{4})\)\s*\[audiobook PL\]$/i;
  const match = title.match(pattern);

  if (match) {
    return {
      authors: match[1].split(/\s*,\s*|\s*i\s+|\s+oraz\s+/i),
      cleanTitle: match[2],
      year: parseInt(match[3], 10)
    };
  }
  return null;
}

function calculateStringSimilarity(str1, str2) {
  const norm1 = normalizeString(str1);
  const norm2 = normalizeString(str2);
  
  if (norm1 === norm2) return 100;
  
  // Levenshtein distance
  const levenshteinDistance = (s1, s2) => {
    const matrix = [];
    for (let i = 0; i <= s2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= s1.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= s2.length; i++) {
      for (let j = 1; j <= s1.length; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[s2.length][s1.length];
  };
  
  const distance = levenshteinDistance(norm1, norm2);
  const maxLen = Math.max(norm1.length, norm2.length);
  const similarity = maxLen === 0 ? 100 : ((maxLen - distance) / maxLen) * 100;
  
  return Math.max(0, similarity);
}

function calculateKeywordMatch(text, keywords) {
  const normText = normalizeString(text);
  const normKeywords = normalizeString(keywords);
  
  if (!normKeywords) return 0;
  
  const keywordsList = normKeywords.split(/\s+/);
  let matchScore = 0;
  
  for (const keyword of keywordsList) {
    if (keyword.length < 2) continue;
    
    if (normText.includes(keyword)) {
      // Dodatkowe punkty za dokładne dopasowanie całego słowa
      const wordBoundaryRegex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (wordBoundaryRegex.test(normText)) {
        matchScore += 30;
      } else {
        matchScore += 15;
      }
    }
  }
  
  return Math.min(matchScore, 100);
}

function calculateMatchScore(book, query, author) {
  let score = 0;
  const normQuery = normalizeString(query);
  const normAuthor = author ? normalizeString(author) : '';
  const normTitle = normalizeString(book.cleanTitle || book.title);
  const normBookAuthors = book.authors.map(a => normalizeString(a));
  
  // 1. Podobieństwo tytułu - zwiększona waga (50%)
  const titleSimilarity = calculateStringSimilarity(normTitle, normQuery);
  score += titleSimilarity * 0.5;
  
  // 2. Dopasowanie słów kluczowych w tytule - zmniejszona waga (25%)
  const keywordMatch = calculateKeywordMatch(normTitle, normQuery);
  score += keywordMatch * 0.25;
  
  // 3. Dopasowanie autora - zwiększona waga (25%)
  if (normAuthor) {
    let authorScore = 0;
    for (const bookAuthor of normBookAuthors) {
      const authorSimilarity = calculateStringSimilarity(bookAuthor, normAuthor);
      authorScore = Math.max(authorScore, authorSimilarity);
    }
    score += authorScore * 0.25;
  }
  
  // 4. Zwiększone kary za słabe dopasowanie
  if (titleSimilarity < 80 && keywordMatch < 50) {
    score *= 0.3; // Bardzo duża kara za słabe dopasowanie
  }
  
  // 5. Dokładne dopasowanie - większy bonus
  if (normTitle === normQuery) {
    score += 100; // Zwiększony bonus za dokładne dopasowanie
  }
  
  // 6. Dopasowanie początku tytułu - większy bonus
  if (normTitle.startsWith(normQuery) || normQuery.startsWith(normTitle)) {
    score += 50; // Zwiększony bonus
  }
  
  // 7. Nowy bonus za bardzo wysokie podobieństwo tytułu
  if (titleSimilarity >= 95) {
    score += 75; // Bonus za niemal identyczny tytuł
  }
  
  // 8. Bonus za bardzo wysokie dopasowanie autora
  if (normAuthor && normBookAuthors.some(bookAuthor => {
    const authorSimilarity = calculateStringSimilarity(bookAuthor, normAuthor);
    return authorSimilarity >= 95;
  })) {
    score += 50; // Bonus za niemal identycznego autora
  }
  
  // 9. Kara za zbyt krótkie zapytanie (może być nieprecyzyjne)
  if (normQuery.length < 3) {
    score *= 0.5;
  }
  
  // 10. Bonus za dopasowanie wszystkich słów z zapytania
  const queryWords = normQuery.split(/\s+/).filter(word => word.length > 2);
  const titleWords = normTitle.split(/\s+/);
  const matchedWords = queryWords.filter(queryWord => 
    titleWords.some(titleWord => titleWord.includes(queryWord) || queryWord.includes(titleWord))
  );
  
  if (queryWords.length > 0 && matchedWords.length === queryWords.length) {
    score += 40; // Bonus za dopasowanie wszystkich słów
  }
  
  return Math.min(score, 300); // Zwiększony maksymalny wynik do 300
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

// Dodane zmienne środowiskowe dla progów dopasowania
const MIN_SCORE_THRESHOLD = parseInt(process.env.MIN_SCORE_THRESHOLD) || 150;
const STRICT_MATCHING = (process.env.STRICT_MATCHING || 'true').toLowerCase() === 'true';

class AudiotekaProvider {
  constructor() {
    this.id = 'audioteka';
    this.name = 'Audioteka';
    this.baseUrl = 'https://audioteka.com';
    this.searchUrl = language === 'cz' ?
      'https://audioteka.com/cz/vyhledavani' :
      'https://audioteka.com/pl/szukaj';
  }

  async searchBooks(query, author = '', page = 1) {
    try {
      const searchUrl = `${this.searchUrl}?phrase=${encodeURIComponent(query)}&page=${page}`;
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept-Language': language === 'cz' ? 'cs-CZ' : 'pl-PL'
        }
      });
      const $ = cheerio.load(response.data);

      const matches = [];
      const $books = $('.adtk-item.teaser_teaser__FDajW');

      $books.each((index, element) => {
        const $book = $(element);
        const title = $book.find('.teaser_title__hDeCG').text().trim();
        const bookUrl = this.baseUrl + $book.find('.teaser_link__fxVFQ').attr('href');
        const authors = [$book.find('.teaser_author__LWTRi').text().trim()];
        const cover = cleanCoverUrl($book.find('.teaser_coverImage__YMrBt').attr('src'));
        const rating = parseFloat($book.find('.teaser-footer_rating__TeVOA').text().trim()) || null;
        const id = $book.attr('data-item-id') || bookUrl.split('/').pop();

        if (title && bookUrl && authors.length > 0 && authors[0]) {
          matches.push({ id, title, authors, url: bookUrl, cover, rating });
        }
      });

      const nextPageLink = $('a[aria-label="Next"]');
      return { matches, hasMore: nextPageLink.length > 0 };
    } catch (error) {
      console.error('Error searching books:', error.message);
      return { matches: [], hasMore: false };
    }
  }

  async getFullMetadata(match) {
    try {
      const response = await axios.get(match.url);
      const $ = cheerio.load(response.data);

      // Extract narrator
      const narrators = language === 'cz'
        ? $('dt:contains("Interpret")').next('dd').find('a').map((i, el) => $(el).text().trim()).get().join(', ')
        : $('dt:contains("Głosy")').next('dd').find('a').map((i, el) => $(el).text().trim()).get().join(', ');

      // Extract duration
      const durationStr = language === 'cz'
        ? $('dt:contains("Délka")').next('dd').text().trim()
        : $('dt:contains("Długość")').next('dd').text().trim();
      const durationInMinutes = parseDuration(durationStr);

      // Extract publisher
      const publisher = language === 'cz'
        ? $('dt:contains("Vydavatel")').next('dd').find('a').first().text().trim()
        : $('dt:contains("Wydawca")').next('dd').find('a').first().text().trim();

      // Extract genres
      const genres = language === 'cz'
        ? $('dt:contains("Kategorie")').next('dd').find('a').map((i, el) => $(el).text().trim()).get()
        : $('dt:contains("Kategoria")').next('dd').find('a').map((i, el) => $(el).text().trim()).get();

      // Extract rating
      const ratingText = $('.star-icon_label__wbNAx').text().trim();
      const rating = ratingText ? parseFloat(ratingText.replace(',', '.')) : null;

      // Extract description
      let description = '';
      const descriptionElement = $('.description_description__6gcfq');
      
      if (descriptionElement.length > 0) {
        description = descriptionElement.html() || descriptionElement.text().trim();
        
        if (description && !description.includes('<')) {
          description = description.replace(/\n\s*\n/g, '\n\n').trim();
        }
      }

      // Add Audioteka link if enabled
      if (addAudiotekaLinkToDescription) {
        const audioTekaLink = `<a href="${match.url}">Audioteka link</a>`;
        description = description ? 
          `${audioTekaLink}\n\n${description}` : 
          audioTekaLink;
      }

      // Extract cover
      const cover = cleanCoverUrl($('.product-top_cover__Pth8B').attr('src') || match.cover);

      // Extract published year
      let publishedYear;
      const yearMatch = $('dt:contains("Rok vydání"), dt:contains("Rok wydania")').next('dd').text().trim();
      if (yearMatch) publishedYear = parseInt(yearMatch, 10);

      // Extract title components
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
        duration: durationInMinutes,
        publisher,
        description,
        genres,
        rating,
        publishedYear: titleComponents.year,
        identifiers: { audioteka: match.id },
        languages: [language === 'cz' ? 'czech' : 'polish']
      };
    } catch(error) {
      console.error(`Error fetching metadata for ${match.title}:`, error.message);
      return match;
    }
  }
}

const provider = new AudiotekaProvider();

app.get('/search', async (req, res) => {
  try {
    const { query, author = '', page = 1 } = req.query;
    if (!query) return res.status(400).json({ error: 'Query parameter is required' });

    console.log(`Searching for: "${query}" by "${author}" (strict matching: ${STRICT_MATCHING}, min score: ${MIN_SCORE_THRESHOLD})`);

    // Search across multiple pages
    let allMatches = [];
    let currentPage = parseInt(page);
    let hasMore = true;
    let pageCount = 0;

    while (hasMore && allMatches.length < MAX_RESULTS * 2 && pageCount < 5) {
      const { matches, hasMore: more } = await provider.searchBooks(query, author, currentPage);
      allMatches = [...allMatches, ...matches];
      hasMore = more;
      currentPage++;
      pageCount++;
      
      if (matches.length === 0) break; // Przerwij jeśli nie ma więcej wyników
    }

    console.log(`Found ${allMatches.length} initial matches`);

    // Score and sort results
    const scoredMatches = allMatches.map(book => {
      const components = extractTitleComponents(book.title) || {
        authors: book.authors,
        cleanTitle: book.title,
        year: new Date().getFullYear()
      };
      const bookWithComponents = { ...book, ...components };
      const score = calculateMatchScore(bookWithComponents, query, author);
      
      return {
        ...bookWithComponents,
        score
      };
    }).sort((a, b) => b.score - a.score);

    // Zastosowanie ostrzejszego filtrowania
    const filteredMatches = scoredMatches.filter(match => {
      if (STRICT_MATCHING) {
        return match.score >= MIN_SCORE_THRESHOLD;
      } else {
        return match.score > 20; // Stare kryterium jako fallback
      }
    });
    
    console.log(`After filtering (min score: ${MIN_SCORE_THRESHOLD}): ${filteredMatches.length} matches`);

    if (filteredMatches.length === 0) {
      console.log('No matches found with high enough score. Top 5 scores:', 
        scoredMatches.slice(0, 5).map(r => ({ 
          title: r.cleanTitle, 
          score: r.score.toFixed(2) 
        }))
      );
    }

    // Get metadata for top results
    const topMatches = filteredMatches.slice(0, MAX_RESULTS);
    const fullMetadata = await Promise.all(
      topMatches.map(async (match) => {
        const metadata = await provider.getFullMetadata(match);
        return { ...metadata, score: match.score };
      })
    );

    // Sort final results by score
    const sortedResults = fullMetadata.sort((a, b) => b.score - a.score);

    console.log(`Returning ${sortedResults.length} high-quality results`);
    if (sortedResults.length > 0) {
      console.log('Top 3 scores:', sortedResults.slice(0, 3).map(r => ({ 
        title: r.cleanTitle, 
        score: r.score.toFixed(2) 
      })));
    }

    // Format response
    res.json({
      matches: sortedResults.map(book => ({
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
      })),
      searchInfo: {
        totalFound: allMatches.length,
        afterFiltering: filteredMatches.length,
        returned: sortedResults.length,
        minScoreThreshold: MIN_SCORE_THRESHOLD,
        strictMatching: STRICT_MATCHING
      }
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Audioteka provider listening on port ${port}, language: ${language}`);
  console.log(`Configuration: MIN_SCORE_THRESHOLD=${MIN_SCORE_THRESHOLD}, STRICT_MATCHING=${STRICT_MATCHING}`);
});