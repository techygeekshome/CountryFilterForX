// Country and region data shared by the content script, popup and account list.
// X shows either a country ("United Kingdom") or a broad region ("Africa") in
// "Account based in". A ticked region matches both its countries and region labels.
(() => {
  const GROUPS = {
    'Africa': {
      aliases: ['Africa'],
      countries: ['Algeria','Angola','Benin','Botswana','Burkina Faso','Burundi','Cabo Verde','Cape Verde','Cameroon','Central African Republic','Chad','Comoros','Congo','Republic of the Congo','Democratic Republic of the Congo','DR Congo','Congo - Kinshasa','Congo - Brazzaville',"Côte d'Ivoire",'Ivory Coast','Djibouti','Egypt','Equatorial Guinea','Eritrea','Eswatini','Swaziland','Ethiopia','Gabon','Gambia','The Gambia','Ghana','Guinea','Guinea-Bissau','Kenya','Lesotho','Liberia','Libya','Madagascar','Malawi','Mali','Mauritania','Mauritius','Morocco','Mozambique','Namibia','Niger','Nigeria','Rwanda','São Tomé and Príncipe','Sao Tome and Principe','Senegal','Seychelles','Sierra Leone','Somalia','South Africa','South Sudan','Sudan','Tanzania','Togo','Tunisia','Uganda','Zambia','Zimbabwe','Western Sahara']
    },
    'Europe': {
      aliases: ['Europe','European Union','EU'],
      countries: ['Albania','Andorra','Austria','Belarus','Belgium','Bosnia and Herzegovina','Bulgaria','Croatia','Cyprus','Czechia','Czech Republic','Denmark','Estonia','Finland','France','Germany','Greece','Hungary','Iceland','Ireland','Italy','Kosovo','Latvia','Liechtenstein','Lithuania','Luxembourg','Malta','Moldova','Monaco','Montenegro','Netherlands','North Macedonia','Norway','Poland','Portugal','Romania','Russia','San Marino','Serbia','Slovakia','Slovenia','Spain','Sweden','Switzerland','Ukraine','United Kingdom','UK','Vatican City']
    },
    'Middle East / West Asia': {
      aliases: ['Middle East','West Asia','Western Asia'],
      countries: ['Bahrain','Iran','Iraq','Israel','Jordan','Kuwait','Lebanon','Oman','Palestine','Palestinian Territories','Qatar','Saudi Arabia','Syria','Turkey','Türkiye','United Arab Emirates','UAE','Yemen','Armenia','Azerbaijan','Georgia']
    },
    'South Asia': {
      aliases: ['South Asia','Southern Asia'],
      countries: ['Afghanistan','Bangladesh','Bhutan','India','Maldives','Nepal','Pakistan','Sri Lanka']
    },
    'Southeast Asia': {
      aliases: ['Southeast Asia','South-East Asia','South East Asia'],
      countries: ['Brunei','Cambodia','Indonesia','Laos','Malaysia','Myanmar','Philippines','Singapore','Thailand','Timor-Leste','East Timor','Vietnam']
    },
    'East Asia': {
      aliases: ['East Asia','East Asia & Pacific','East Asia and Pacific','Eastern Asia'],
      countries: ['China','Hong Kong','Japan','Macau','Macao','Mongolia','North Korea','South Korea','Korea','Taiwan']
    },
    'Central Asia': {
      aliases: ['Central Asia'],
      countries: ['Kazakhstan','Kyrgyzstan','Tajikistan','Turkmenistan','Uzbekistan']
    },
    'North America': {
      aliases: ['North America','Northern America'],
      countries: ['United States','USA','US','Canada','Mexico','Greenland']
    },
    'Central America & Caribbean': {
      aliases: ['Central America','Caribbean','Latin America & Caribbean','Latin America and Caribbean'],
      countries: ['Antigua and Barbuda','Bahamas','Barbados','Belize','Costa Rica','Cuba','Dominica','Dominican Republic','El Salvador','Grenada','Guatemala','Haiti','Honduras','Jamaica','Nicaragua','Panama','Puerto Rico','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Trinidad and Tobago']
    },
    'South America': {
      aliases: ['South America','Latin America'],
      countries: ['Argentina','Bolivia','Brazil','Chile','Colombia','Ecuador','Guyana','Paraguay','Peru','Suriname','Uruguay','Venezuela']
    },
    'Oceania': {
      aliases: ['Oceania','Pacific','Australia and New Zealand'],
      countries: ['Australia','Fiji','Kiribati','Marshall Islands','Micronesia','Nauru','New Zealand','Palau','Papua New Guinea','Samoa','Solomon Islands','Tonga','Tuvalu','Vanuatu']
    }
  };

  // "Asia (all)" covers every Asian sub-group plus any label containing "Asia".
  const asianGroups = ['Middle East / West Asia','South Asia','Southeast Asia','East Asia','Central Asia'];
  GROUPS['Asia (all)'] = {
    aliases: ['Asia'].concat(...asianGroups.map(g => GROUPS[g].aliases)),
    countries: [].concat(...asianGroups.map(g => GROUPS[g].countries)),
    keyword: 'asia'
  };
  GROUPS['Africa'].keyword = 'africa';

  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  const index = {};
  for (const [name, g] of Object.entries(GROUPS)) {
    index[name] = new Set([...g.aliases, ...g.countries].map(norm));
  }

  // Every distinct country name (first spelling wins), for the popup search.
  const seen = new Set();
  const COUNTRIES = [];
  for (const [name, g] of Object.entries(GROUPS)) {
    if (name === 'Asia (all)') continue;
    for (const c of g.countries) {
      if (c.length <= 3) continue; // skip "UK", "US", "UAE" short aliases in search list
      if (!seen.has(norm(c))) { seen.add(norm(c)); COUNTRIES.push(c); }
    }
  }
  COUNTRIES.sort((a, b) => a.localeCompare(b));

  // Does a location label match one ticked entry (a region name or a country/label)?
  function matchesEntry(loc, entry) {
    const l = norm(loc);
    if (!l) return false;
    const g = GROUPS[entry];
    if (g) {
      if (index[entry].has(l)) return true;
      if (g.keyword && l.includes(g.keyword)) return true;
      return false;
    }
    return l === norm(entry);
  }

  function matchesAny(loc, entries) {
    for (const e of entries) if (matchesEntry(loc, e)) return e;
    return null;
  }

  // "Nigeria App Store" -> "Nigeria", "Africa Android App" -> "Africa", "Web" -> null
  function viaPlace(via) {
    if (!via) return null;
    const m = String(via).match(/^(.*?)\s+(App Store|Android App|Google Play Store|Google Play|Android|App)$/i);
    const place = m ? m[1].trim() : '';
    if (!place || /^(android|ios|iphone|ipad|web|google play)$/i.test(place)) return null;
    return place;
  }

  const api = { GROUPS, REGION_NAMES: Object.keys(GROUPS), COUNTRIES, matchesEntry, matchesAny, viaPlace, norm };
  (typeof window !== 'undefined' ? window : self).XCF_REGIONS = api;
})();
