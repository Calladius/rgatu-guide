#!/usr/bin/env node
/**
 * Единый парсер данных РГАТУ им. П.А. Соловьёва + генератор SVG-карт
 *
 * Возможности:
 *   - Автоматический парсинг руководства и институтов с сайта rsatu.ru
 *   - Резервные данные (fallback) если сайт недоступен
 *   - Генерация SVG-карт 5 этажей
 *   - Режимы: полный / только данные / только SVG
 *
 * Запуск:
 *   node parse.js              — полный парсинг + SVG
 *   node parse.js --data-only  — только JSON-данные
 *   node parse.js --svg-only   — только SVG-карты
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

// ============================================
// Конфигурация
// ============================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(BASE_DIR, 'src');
const DATA_DIR = path.join(SRC_DIR, 'data');
const MAPS_DIR = path.join(SRC_DIR, 'maps');

const BASE_URL = 'https://www.rsatu.ru';
const USER_AGENT = 'RGATU-Guide-Bot/2.0 (Educational Project; +https://github.com/rgatu-guide)';
const FETCH_TIMEOUT = 20000;

const args = process.argv.slice(2);
const DATA_ONLY = args.includes('--data-only');
const SVG_ONLY = args.includes('--svg-only');

// ============================================
// Утилиты
// ============================================

/** Создать папку если не существует */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Сохранить JSON-файл */
function saveJson(data, filename) {
  ensureDir(DATA_DIR);
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  const size = fs.statSync(filepath).size;
  console.log(`  ✓ ${filename} (${(size / 1024).toFixed(1)} КБ)`);
}

/** Сохранить текстовый файл */
function saveText(content, filepath) {
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, content, 'utf8');
  const size = fs.statSync(filepath).size;
  console.log(`  ✓ ${path.basename(filepath)} (${(size / 1024).toFixed(1)} КБ)`);
}

/** Загрузка HTML-страницы */
async function fetchPage(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    console.log(`  ↳ Загружено: ${url} (${(html.length / 1024).toFixed(0)} КБ)`);
    return html;
  } catch (e) {
    console.warn(`  ⚠ Не удалось загрузить ${url}: ${e.message}`);
    return null;
  }
}

/** Очистить текст: удалить лишние пробелы и переносы */
function cleanText(str) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

// ============================================
// Парсинг руководства с сайта
// ============================================

async function parseLeadership() {
  console.log('\n📋 Парсинг руководства...');
  const html = await fetchPage(`${BASE_URL}/university/administration/`);
  if (!html) {
    console.log('  → Используем резервные данные руководства');
    return FALLBACK_LEADERSHIP;
  }

  const $ = cheerio.load(html);
  const leaders = [];

  // Находим карточки руководителей на сайте РГАТУ
  // Структура: .teachers-item > .teachers-item_name, .teachers-item_post, .teachers-item_degree
  const cards = $('.teachers-item');

  cards.each(function() {
    const card = $(this);
    // Имя: фамилия в <span class="d-block text-uppercase"> + имя/отчество после
    const nameEl = card.find('.teachers-item_name');
    const lastName = nameEl.find('span.d-block, span.text-uppercase').text().trim();
    const restOfName = nameEl.text().replace(lastName, '').trim();
    const name = cleanText(lastName + ' ' + restOfName);

    const position = cleanText(card.find('.teachers-item_post').text());
    // Степень: убираем склеенные слова (доктортехническихнаук → доктор технических наук)
    let degree = cleanText(card.find('.teachers-item_degree').text());
    degree = degree
      .replace(/доктор([\а-яё])/g, 'доктор $1')
      .replace(/кандидат([\а-яё])/g, 'кандидат $1')
      .replace(/наук([\а-яё])/g, 'наук $1')
      .replace(/\s+/g, ' ').trim();

    const phone = cleanText(card.find('a[href^="tel:"]').text());
    const email = cleanText(card.find('a[href^="mailto:"]').text());

    if (name && position) {
      leaders.push({ name, position, degree, phone, email });
    }
  });

  if (leaders.length === 0) {
    console.log('  → Не удалось распарсить, используем резервные данные');
    return FALLBACK_LEADERSHIP;
  }

  // Дополняем недостающие поля (комнаты, этажи) из резервных данных
  const result = leaders.map(l => {
    const fb = FALLBACK_LEADERSHIP.find(f =>
      f.name === l.name ||
      (f.name && l.name &&
       f.name.split(' ')[0] === l.name.split(' ')[0] &&
       f.name.split(' ').length > 1 && l.name.split(' ').length > 1 &&
       f.name.split(' ')[1] === l.name.split(' ')[1]));

    return {
      name: l.name,
      position: l.position || fb?.position || '',
      degree: l.degree || fb?.degree || '',
      phone: l.phone || fb?.phone || '',
      email: l.email || fb?.email || '',
      room: fb?.room || '',
      floor: fb?.floor || 0,
      ...(fb?.reception ? { reception: fb.reception } : {}),
      ...(fb?.fax ? { fax: fb.fax } : {}),
    };
  });

  // Добавляем руководителей из fallback, которых нет на сайте
  for (const fb of FALLBACK_LEADERSHIP) {
    if (!result.find(r => r.name === fb.name)) {
      result.push(fb);
    }
  }

  console.log(`  → Найдено ${leaders.length} руководителей с сайта, итог: ${result.length}`);
  return result;
}

// ============================================
// Парсинг институтов и кафедр с сайта
// ============================================

async function parseInstitutes() {
  console.log('\n🏛️ Парсинг институтов и кафедр...');
  const html = await fetchPage(`${BASE_URL}/university/institutions-and-departments/`);
  if (!html) {
    console.log('  → Используем резервные данные институтов');
    return FALLBACK_DEPARTMENTS;
  }

  const $ = cheerio.load(html);
  const institutes = [];

  // Находим блоки институтов на странице
  // Структура: div.h5 > a (название), .list-departments > li > a (кафедры),
  // tel: и mailto: ссылки, текст "Адрес:"
  const instHeaders = $('div.h5:contains("Институт «")');

  instHeaders.each(function() {
    const headerDiv = $(this);
    const linkEl = headerDiv.find('a').first();
    const name = cleanText(linkEl.text());
    const instUrl = linkEl.attr('href') || '';

    // Поднимаемся к родительскому блоку института
    const block = headerDiv.closest('div.d-flex.flex-column');

    // Кафедры
    const deptNames = [];
    block.find('.list-departments li a').each(function() {
      const dName = cleanText($(this).text());
      if (dName.startsWith('Кафедра')) deptNames.push(dName);
    });

    // Адрес
    const addressBlock = block.find('div:contains("Адрес:")').filter(function() {
      return $(this).find('.text-grey').length > 0 || $(this).text().startsWith('Адрес:');
    });
    let address = '';
    block.find('div').each(function() {
      const t = $(this).text().trim();
      if (t.startsWith('Адрес:')) {
        address = cleanText(t.replace('Адрес:', ''));
        return false; // break
      }
    });

    // Телефон и email
    const phone = cleanText(block.find('a[href^="tel:"]').first().text());
    const email = cleanText(block.find('a[href^="mailto:"]').first().text());

    if (name && name.includes('Институт')) {
      institutes.push({ name, address, phone, email, deptNames, url: instUrl });
    }
  });

  if (institutes.length === 0) {
    console.log('  → Не удалось распарсить, используем резервные данные');
    return FALLBACK_DEPARTMENTS;
  }

  // Обогащаем данные из резервных (комнаты, этажи, цвета, заведующие)
  const result = institutes.map(inst => {
    const fb = FALLBACK_DEPARTMENTS.find(f =>
      f.name.includes(inst.name.replace('Институт «', '').replace('»', '')) ||
      inst.name.includes(f.shortName));

    const shortName = fb?.shortName ||
      (inst.name.includes('Авиационные') ? 'ИАТИФ' :
       inst.name.includes('Информационные') ? 'ИИТСУ' :
       inst.name.includes('непрерывного') ? 'ИНО' : '');

    const departments = inst.deptNames.map(dName => {
      const fbDept = fb?.departments?.find(fd =>
        fd.name === dName || fd.name.includes(dName.replace('Кафедра ', '')));
      return {
        name: dName,
        head: fbDept?.head || '—',
        headTitle: fbDept?.headTitle || '',
        room: fbDept?.room || '',
        floor: fbDept?.floor || 0,
        phone: fbDept?.phone || inst.phone,
      };
    });

    // Добавляем кафедры из fallback, которых нет на сайте
    if (fb?.departments) {
      for (const fbDept of fb.departments) {
        if (!departments.find(d => d.name === fbDept.name)) {
          departments.push(fbDept);
        }
      }
    }

    return {
      name: inst.name,
      shortName,
      address: inst.address || fb?.address || '',
      phone: inst.phone || fb?.phone || '',
      email: inst.email || fb?.email || '',
      director: fb?.director || '',
      directorTitle: fb?.directorTitle || '',
      url: inst.url ? (inst.url.startsWith('http') ? inst.url : BASE_URL + inst.url) : (fb?.url || ''),
      floor: fb?.floor || 0,
      room: fb?.room || '',
      color: fb?.color || '#1565C0',
      departments,
    };
  });

  // Добавляем институты из fallback, которых нет на сайте (например ИНО)
  for (const fb of FALLBACK_DEPARTMENTS) {
    if (!result.find(r => r.shortName === fb.shortName)) {
      result.push(fb);
    }
  }

  console.log(`  → Найдено ${institutes.length} институтов с сайта, итог: ${result.length}`);
  return result;
}

// ============================================
// Резервные данные (fallback)
// ============================================

const FALLBACK_LEADERSHIP = [
  { name: 'Кошкин Валерий Иванович', position: 'Ректор', degree: 'Доктор физико-математических наук', phone: '+7 (4855) 23-97-24', fax: '(4855) 28-04-75', email: 'rector@rsatu.ru', room: '107', floor: 1, reception: 'Каждая среда 14:00-16:00, запись по тел. 8(4855)23-97-22' },
  { name: 'Сутягин Александр Николаевич', position: 'Первый проректор – проректор по науке и цифровой трансформации', degree: 'Кандидат технических наук', phone: '+7 (4855) 23-97-43', email: 'sutyagin.an@rsatu.ru', room: '405', floor: 4 },
  { name: 'Шпилева Юлия Владимировна', position: 'Проректор по учебно-методической работе', degree: 'Кандидат филологических наук', phone: '+7 (4855) 23-97-85', email: 'uvs@rsatu.ru', room: '225а', floor: 2 },
  { name: 'Горячева Наталия Вадимовна', position: 'Проректор по молодежной политике и социальной работе', degree: 'Кандидат технических наук', phone: '+7 (4855) 23-97-47', email: 'goryacheva@rsatu.ru', room: '221', floor: 2 },
  { name: 'Рябов Альберт Николаевич', position: 'Проректор по безопасности', degree: 'Кандидат технических наук', phone: '+7 (4855) 23-97-40', email: 'ryabov@rsatu.ru', room: '98', floor: 1 },
  { name: 'Головкин Сергей Михайлович', position: 'Проректор по инфраструктурному развитию и управлению кампусом', degree: 'Кандидат технических наук', phone: '+7 (4855) 23-97-35', email: 'golovkin-sm@rsatu.ru', room: '104', floor: 1 },
  { name: 'Резник Татьяна Вячеславовна', position: 'Проректор по экономике и финансам', degree: '', phone: '+7 (4855) 23-97-25', email: 'pfu@rsatu.ru', room: '102', floor: 1 },
  { name: 'Гурьянов Александр Игоревич', position: 'И.о. директора ИАТИФ', degree: 'Доктор технических наук', phone: '+7 (4855) 23-97-54', email: 'fad@rsatu.ru', room: '327', floor: 3 },
  { name: 'Ломанов Алексей Николаевич', position: 'И.о. директора ИИТСУ', degree: 'Кандидат технических наук', phone: '+7 (4855) 23-97-59', email: 'frei@rsatu.ru', room: '426', floor: 4 },
  { name: 'Шпилев Дмитрий Александрович', position: 'И.о. директора ИНО', degree: '', phone: '+7 (4855) 23-97-88', email: 'sda@rsatu.ru', room: '223', floor: 2 },
  { name: 'Попков Кирилл Николаевич', position: 'Директор Авиационного колледжа', degree: 'Кандидат технических наук', phone: '+7 (4855) 28-04-30', email: 'kirpopkov@mail.ru', room: '200', floor: 0 },
  { name: 'Малышева Ирина Сергеевна', position: 'Директор по персоналу и общим вопросам', degree: '', phone: '+7 (4855) 27-50-26', email: '', room: '106', floor: 1 },
  { name: 'Долгов Иван Алексеевич', position: 'Директор по развитию', degree: '', phone: '', email: '', room: '', floor: 1 },
  { name: 'Одноколов Сергей Михайлович', position: 'Директор по проектной деятельности', degree: 'Кандидат экономических наук', phone: '', email: 'odnokolov_sm@rsatu.ru', room: '107', floor: 1 },
];

const FALLBACK_DEPARTMENTS = [
  {
    name: 'Институт «Авиационные технологии и инженерная физика»',
    shortName: 'ИАТИФ',
    address: '152934 г. Рыбинск, ул. Пушкина, д.53, ауд. 327',
    phone: '+7 (4855) 23-97-54',
    email: 'fad@rsatu.ru',
    director: 'Гурьянов Александр Игоревич',
    directorTitle: 'И.о. директора, доктор технических наук',
    url: `${BASE_URL}/university/struct/291/`,
    floor: 3, room: '327', color: '#1565C0',
    departments: [
      { name: 'Кафедра инновационного машиностроения', head: 'Безъязычный Вячеслав Феоктистович', headTitle: 'Профессор, доктор технических наук', room: '311', floor: 3, phone: '+7 (4855) 23-97-54' },
      { name: 'Кафедра авиационных двигателей', head: 'Храмин Роман Владимирович', headTitle: 'Заведующий кафедрой, кандидат технических наук', room: '325', floor: 3, phone: '+7 (4855) 23-97-54' },
      { name: 'Кафедра материаловедения, литья и сварки', head: 'Шатульский Александр Анатольевич', headTitle: 'Заведующий кафедрой, доктор технических наук', room: '329', floor: 3, phone: '+7 (4855) 23-97-54' },
      { name: 'Кафедра общей и технической физики', head: 'Веретенников Сергей Владимирович', headTitle: 'Заведующий кафедрой, доктор технических наук', room: '335', floor: 3, phone: '+7 (4855) 23-97-54' },
      { name: 'Кафедра прикладной механики', head: 'Болотин Алексей Николаевич', headTitle: 'Заведующий кафедрой, кандидат технических наук', room: '337', floor: 3, phone: '+7 (4855) 23-97-54' },
    ],
  },
  {
    name: 'Институт «Информационные технологии и системы управления»',
    shortName: 'ИИТСУ',
    address: '152934, г. Рыбинск, ул. Пушкина, д.53, ауд. 426',
    phone: '+7 (4855) 23-97-59',
    email: 'itms@rsatu.ru',
    director: 'Ломанов Алексей Николаевич',
    directorTitle: 'И.о. директора, кандидат технических наук',
    url: `${BASE_URL}/university/struct/292/`,
    floor: 4, room: '426', color: '#2E7D32',
    departments: [
      { name: 'Кафедра экономики, менеджмента и экономических информационных систем', head: 'Камакина Ольга Владимировна', headTitle: 'Заведующая кафедрой, кандидат экономических наук', room: '428', floor: 4, phone: '+7 (4855) 23-97-59' },
      { name: 'Кафедра вычислительных систем', head: 'Комаров Валерий Михайлович', headTitle: 'Заведующий кафедрой, кандидат технических наук', room: '430', floor: 4, phone: '+7 (4855) 23-97-59' },
      { name: 'Кафедра математического и программного обеспечения электронных вычислительных средств', head: 'Паламарь Ирина Николаевна', headTitle: 'Заведующая кафедрой, кандидат технических наук', room: '432', floor: 4, phone: '+7 (4855) 23-97-59' },
      { name: 'Кафедра электротехники и программируемой радиоэлектроники', head: 'Юдин Алексей Викторович', headTitle: 'Заведующий кафедрой, доктор технических наук', room: '434', floor: 4, phone: '+7 (4855) 23-97-59' },
      { name: 'Кафедра высшей математики', head: 'Башкин Михаил Анатольевич', headTitle: 'Заведующий кафедрой, кандидат физ.-мат. наук', room: '420', floor: 4, phone: '+7 (4855) 23-97-59' },
      { name: 'Кафедра организации производства и управления качеством', head: 'Киселев Эдуард Валентинович', headTitle: 'Заведующий кафедрой, доктор технических наук', room: '436', floor: 4, phone: '+7 (4855) 23-97-59' },
      { name: 'Кафедра иностранных языков', head: 'Петрова Лариса Адольфовна', headTitle: 'Заведующая кафедрой, кандидат филологических наук', room: '422', floor: 4, phone: '+7 (4855) 23-97-59' },
    ],
  },
  {
    name: 'Институт непрерывного образования',
    shortName: 'ИНО',
    address: '152934, г. Рыбинск, ул. Пушкина, д. 53',
    phone: '+7 (4855) 23-97-52',
    email: 'sda@rsatu.ru',
    director: 'Шпилев Дмитрий Александрович',
    directorTitle: 'И.о. директора',
    url: `${BASE_URL}/university/struct/293/`,
    floor: 2, room: '223', color: '#6A1B9A',
    departments: [
      { name: 'Кафедра гуманитарных технологий и социального проектирования', head: 'Черных Елена Николаевна', headTitle: 'Заведующая кафедрой, кандидат экономических наук', room: '218', floor: 2, phone: '+7 (4855) 23-97-52' },
      { name: 'Кафедра общественных наук', head: 'Лаукарт-Горбачева Ольга Викторовна', headTitle: 'Заведующая кафедрой, кандидат социологических наук', room: '220', floor: 2, phone: '+7 (4855) 23-97-52' },
    ],
  },
];

// ============================================
// Статичные данные (не парсятся автоматически)
// ============================================

function getContacts() {
  return {
    university: {
      fullName: 'Рыбинский государственный авиационный технический университет имени П.А. Соловьёва',
      shortName: 'РГАТУ им. П.А. Соловьёва',
      founded: 1955,
      address: '152934, Россия, Ярославская обл., г. Рыбинск, ул. Пушкина, д.53',
      phone: '+7 (4855) 23-97-22',
      fax: '(4855) 28-04-75',
      email: 'rector@rsatu.ru',
      website: 'https://www.rsatu.ru',
      lk: 'https://lk.rsatu.ru/',
      moodle: 'https://online.rsatu.ru/',
      libraryCatalog: 'http://rsatu.ru:81/',
      vk: 'https://vk.com/ryb_rsatu',
      telegram: 'https://t.me/rsatu_info',
      pish: 'https://pish.rsatu.ru/',
    },
    admissions: {
      name: 'Приёмная комиссия',
      address: '152934, г. Рыбинск, ул. Пушкина, д. 53, Главный корпус, каб. 101',
      phone: '+7 (4855) 23-97-60, +7 (4855) 23-97-61',
      email: 'pk@rsatu.ru',
      schedule: 'Пн-Пт 9:00-18:00, обед 13:00-14:00. Сб, Вс — выходные',
      room: '101', floor: 1,
      secretary: 'Михрютина Анна Викторовна (к.т.н.)',
      deputySecretary: 'Белова Светлана Евгеньевна (к.т.н.)',
      unifiedContact: '8 (800) 301-44-55, priemvuz.ru',
    },
    cro: {
      name: 'ЦРО (Центр по работе с обучающимися)',
      address: '152934, г. Рыбинск, ул. Пушкина, д. 53, ауд. 203',
      phone: '+7 (4855) 23-98-00',
      directorPhone: '+7 (4855) 23-98-03',
      email: 'cro@rsatu.ru',
      schedule: 'Пн-Пт 8:30-17:30, обед 12:30-13:30, Сб-Вс выходные',
      director: 'Семенова Юлия Валентиновна (к.т.н.), каб. 205б',
      deputy: 'Седлецкая Светлана Эрнстовна, каб. 203',
      staff: ['Алябьева Анастасия Геннадьевна', 'Алябьева Ольга Николаевна', 'Блинова Татьяна Анатольевна', 'Пиянина Ольга Николаевна'],
    },
    fzo: {
      name: 'Факультет заочного обучения (ФЗО)',
      address: 'ул. Пушкина, д.53, каб. 205',
      phone: '+7 (4855) 23-98-05',
      email: 'fzo@rsatu.ru',
      schedule: 'Пн-Пт 8:30-17:30, обед 12:30-13:30, Сб-Вс выходные',
      dean: 'Семенова Юлия Валентиновна, каб. 205б, +7 (4855) 23-98-00',
      deputyDean: 'Седлецкая Светлана Эрнстовна, каб. 203, +7 (4855) 23-98-03',
      specialist: 'Сирмакова Лариса Николаевна, каб. 205, +7 (4855) 23-98-05',
    },
    careerCenter: {
      name: 'Центр карьеры',
      address: 'ул. Пушкина, д.53, каб. 311',
      phone: '+7 (4855) 23-97-12',
      email: 'manina_nv@rsatu.ru',
      head: 'Манина Надежда Владимировна',
      partners: ['ПАО «ОДК-Сатурн»', 'НПО «Криста»', 'АО КБ «Луч»', 'ООО «Рыбинский завод приборостроения»', 'АО «Русская механика»', 'АО «ОДК-Газовые турбины»'],
    },
    library: {
      main: { name: 'Библиотека (Главный корпус)', address: 'ул. Пушкина, д.53, 2 этаж', schedule: 'Пн-Пт 8:00-19:00, Сб 8:00-17:00, обед 12:00-13:00, Вс выходной', head: 'Павлычева Ольга Вячеславовна, каб. 201, pavlycheva_ov@rsatu.ru' },
      second: { name: 'Библиотека (Второй корпус)', address: 'ул. Луначарского, д.2, 1 этаж', schedule: 'Пн-Пт 8:00-18:00, Сб 8:00-12:00, Вс выходной' },
      ebs: [{ name: 'Университетская библиотека онлайн', url: 'https://biblioclub.ru/' }, { name: 'Znanium', url: 'https://znanium.ru/' }, { name: 'НЭБ (Национальная электронная библиотека)', url: '' }],
      catalog: 'http://rsatu.ru:81/',
      fundSize: '600 000+ книг',
      journal: 'Вестник РГАТА имени П.А. Соловьева',
    },
    dormitory: { name: 'Общежитие №1', address: '152934, Ярославская обл., г. Рыбинск, ул. Румянцевская, д.60', phone: '+7 (4855) 22-21-25' },
    hotlines: {
      legal: '8 (800) 222-55-71 (доб. 1) — правовая и социальная защита обучающихся',
      psychological: '8 (800) 222-55-71 (доб. 2) — психологическая помощь студенческой молодежи',
    },
    bellSchedule: {
      weekdays: [
        { pair: 1, time: '8:30–10:05' }, { pair: 2, time: '10:15–11:50' },
        { pair: 3, time: '12:40–14:15' }, { pair: 4, time: '14:25–16:00' },
        { pair: 5, time: '16:10–17:45' }, { pair: 6, time: '18:00–19:25' },
        { pair: 7, time: '19:35–21:00' },
      ],
      weekends: [
        { pair: 1, time: '8:30–10:05' }, { pair: 2, time: '10:15–11:50' },
        { pair: 3, time: '12:00–13:35' }, { pair: 4, time: '13:45–15:20' },
        { pair: 5, time: '15:30–17:05' }, { pair: 6, time: '17:15–18:40' },
        { pair: 7, time: '18:50–20:15' },
      ],
    },
    studentLife: {
      sport: { name: 'Центр физической культуры и спорта (ЦФКиС)', director: 'Шаров Михаил Александрович' },
      creativity: { name: 'Культурно-просветительский центр «Компас»', director: 'Ковалева Ирина Фёдоровна, каб. 201, kovaleva_if@rsatu.ru' },
      prometheus: { name: 'Студенческий клуб «Прометей»', director: 'Сорнева Людмила Геннадьевна', artDirector: 'Яснева Алена Евгеньевна' },
      sportClub: { name: 'Спортивный клуб «Ракета» / СК РГАТУ' },
      profsoyuz: { name: 'Профсоюзная организация обучающихся', chairman: 'Барфяна Анаида Суреновна' },
      profkom: { name: 'Профком', chairman: 'Калашникова Ольга Алексеевна' },
      socialWork: { name: 'Отдел по воспитательной и социальной работе', head: 'Лихоманова Анна Алексеевна, каб. 221, +7 (4855) 23-97-46' },
    },
    buildings: {
      main: { name: 'Главный корпус', address: 'ул. Пушкина, д.53' },
      second: { name: 'Второй корпус', address: 'ул. Луначарского, д.2' },
      college: { name: 'Авиационный колледж', address: 'ул. Чкалова, д.93', phone: '+7 (4855) 23-97-87', director: 'Попков Кирилл Николаевич, каб. 200' },
      dormitory: { name: 'Общежитие №1', address: 'ул. Румянцевская, д.60' },
    },
    payments: {
      categories: ['Высшее образование (оплата за обучение)', 'Общежитие', 'Аспирантура', 'Институт непрерывного образования (ИНО)', 'Культурные мероприятия СК «Прометей»', 'Ликвидация академической разницы (ЛАР)', 'Подготовительные курсы', 'Спортивные мероприятия СК «Ракета»', 'Плата за выдачу дубликатов документов'],
      methods: ['Сбербанк Онлайн (приложение)', 'QR-код через Сбербанк Онлайн', 'По ссылке через Сбербанк Онлайн', 'Через кассу (квитанции на сайте)'],
      url: 'https://www.rsatu.ru/students/payment/',
    },
  };
}

function getSubdivisions() {
  return [
    { name: 'Вахта', head: '—', room: '90', floor: 1, phone: '', url: '' },
    { name: 'Служба охраны', head: '—', room: '91', floor: 1, phone: '+7 (4855) 23-97-40', url: 'https://www.rsatu.ru/university/struct/299/' },
    { name: 'Ректорат (приёмная)', head: 'Кошкин Валерий Иванович', room: '107', floor: 1, phone: '+7 (4855) 23-97-22', email: 'rector@rsatu.ru', url: 'https://www.rsatu.ru/university/administration/' },
    { name: 'Приёмная комиссия', head: '—', room: '101', floor: 1, phone: '+7 (4855) 23-97-60', email: 'pk@rsatu.ru', url: 'https://www.rsatu.ru/applicants/the_admissions_committee/' },
    { name: 'Бухгалтерия', head: '—', room: '100', floor: 1, phone: '+7 (4855) 23-97-25', url: 'https://www.rsatu.ru/university/struct/298/' },
    { name: 'Планово-финансовое управление', head: 'Резник Татьяна Вячеславовна', room: '102', floor: 1, phone: '+7 (4855) 23-97-25', email: 'pfu@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/297/' },
    { name: 'Учебно-методическое управление', head: 'Шпилева Юлия Владимировна', room: '103', floor: 1, phone: '+7 (4855) 23-97-85', email: 'uvs@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/392/' },
    { name: 'Управление имущественным комплексом', head: 'Головкин Сергей Михайлович', room: '104', floor: 1, phone: '+7 (4855) 23-97-35', email: 'golovkin-sm@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/335/' },
    { name: 'Центр карьеры', head: 'Манина Надежда Владимировна', room: '311', floor: 3, phone: '+7 (4855) 23-97-12', email: 'manina_nv@rsatu.ru', url: 'https://www.rsatu.ru/graduates/' },
    { name: 'Управление по кадрам и делопроизводству', head: 'Малышева Ирина Сергеевна', room: '106', floor: 1, phone: '+7 (4855) 27-50-26', url: 'https://www.rsatu.ru/university/struct/303/' },
    { name: 'Управление учёта', head: '—', room: '109', floor: 1, phone: '+7 (4855) 23-97-85', url: '' },
    { name: 'Центр международного сотрудничества', head: '—', room: '108', floor: 1, phone: '+7 (4855) 23-97-47', url: 'https://www.rsatu.ru/university/struct/305/' },
    { name: 'Библиотека', head: '—', room: '110', floor: 1, phone: '+7 (4855) 23-97-52', url: 'https://www.rsatu.ru/university/struct/' },
    { name: 'Читальный зал (1 этаж)', head: '—', room: '111', floor: 1, phone: '+7 (4855) 23-97-52', url: '' },
    { name: 'Спортивный зал', head: '—', room: '113', floor: 1, phone: '+7 (4855) 23-97-47', url: 'https://www.rsatu.ru/university/struct/332/' },
    { name: 'Актовый зал', head: '—', room: '115', floor: 1, phone: '+7 (4855) 23-97-46', url: 'https://www.rsatu.ru/university/struct/327/' },
    { name: 'Буфет', head: '—', room: '112', floor: 1, phone: '', url: '' },
    { name: 'Вахта / Охрана', head: '—', room: '98', floor: 1, phone: '+7 (4855) 23-97-40', url: 'https://www.rsatu.ru/university/struct/299/' },
    { name: 'Медицинский пункт', head: '—', room: '108', floor: 1, phone: '+7 (4855) 23-97-47', url: 'https://www.rsatu.ru/university/struct/333/' },
    { name: 'Служба охраны', head: '—', room: '99', floor: 1, phone: '+7 (4855) 23-97-40', url: 'https://www.rsatu.ru/university/struct/299/' },
    { name: 'Гардероб', head: '—', room: '', floor: 1, phone: '', url: '', type: 'cloakroom' },
    { name: 'Зал заседаний', head: '—', room: '118', floor: 1, phone: '', url: '' },
    { name: 'Учебный отдел', head: '—', room: '116', floor: 1, phone: '+7 (4855) 23-97-85', url: '' },
    // 2 этаж
    { name: 'ЦРО (Центр по работе с обучающимися)', head: 'Семенова Юлия Валентиновна', room: '203', floor: 2, phone: '+7 (4855) 23-98-00', email: 'cro@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/303/', type: 'internet-class' },
    { name: 'Проректор по молодежной политике и социальной работе', head: 'Горячева Наталия Вадимовна', room: '221', floor: 2, phone: '+7 (4855) 23-97-47', email: 'goryacheva@rsatu.ru', url: 'https://www.rsatu.ru/university/administration/' },
    { name: 'Факультет заочного обучения', head: '—', room: '215', floor: 2, phone: '+7 (4855) 23-97-52', email: 'fzo@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/302/' },
    { name: 'Центр международного сотрудничества (2 этаж)', head: '—', room: '210', floor: 2, phone: '+7 (4855) 23-97-47', url: 'https://www.rsatu.ru/university/struct/305/' },
    { name: 'Кафедра гуманитарных технологий и социального проектирования', head: '—', room: '218', floor: 2, phone: '+7 (4855) 23-97-52', url: 'https://www.rsatu.ru/university/struct/293/' },
    { name: 'Кафедра общественных наук', head: '—', room: '220', floor: 2, phone: '+7 (4855) 23-97-52', url: 'https://www.rsatu.ru/university/struct/293/' },
    { name: 'Институт непрерывного образования', head: 'Шпилев Дмитрий Александрович', room: '223', floor: 2, phone: '+7 (4855) 23-97-52', email: 'sda@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/293/' },
    { name: 'Компьютерный класс (2 этаж)', head: '—', room: '224', floor: 2, phone: '', url: '' },
    { name: 'Читальный зал', head: '—', room: '', floor: 2, phone: '+7 (4855) 23-97-52', url: '', type: 'reading-room' },
    { name: 'Интернет-класс', head: '—', room: '', floor: 2, phone: '+7 (4855) 23-97-52', url: '', type: 'internet-class' },
    { name: 'Библиографы', head: '—', room: '', floor: 2, phone: '+7 (4855) 23-97-52', url: '', type: 'bibliographers' },
    { name: 'Картотека', head: '—', room: '', floor: 2, phone: '+7 (4855) 23-97-52', url: '', type: 'card-catalog' },
    { name: 'Библиотечный фонд', head: '—', room: '', floor: 2, phone: '+7 (4855) 23-97-52', url: '', type: 'library-fund' },
    // 3 этаж
    { name: 'Дирекция ИАТИФ', head: 'Гурьянов Александр Игоревич', room: '327', floor: 3, phone: '+7 (4855) 23-97-54', email: 'fad@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Кафедра инновационного машиностроения', head: 'Безъязычный Вячеслав Феоктистович', room: '311', floor: 3, phone: '+7 (4855) 23-97-54', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Кафедра авиационных двигателей', head: 'Храмин Роман Владимирович', room: '325', floor: 3, phone: '+7 (4855) 23-97-54', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Кафедра материаловедения, литья и сварки', head: 'Шатульский Александр Анатольевич', room: '329', floor: 3, phone: '+7 (4855) 23-97-54', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Кафедра общей и технической физики', head: 'Веретенников Сергей Владимирович', room: '335', floor: 3, phone: '+7 (4855) 23-97-54', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Кафедра прикладной механики', head: 'Болотин Алексей Николаевич', room: '337', floor: 3, phone: '+7 (4855) 23-97-54', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Лаб. каф. иннов. машиностроения', head: '—', room: '313', floor: 3, phone: '+7 (4855) 23-97-54', url: '' },
    { name: 'Лаб. каф. авиационных двигателей', head: '—', room: '317', floor: 3, phone: '+7 (4855) 23-97-54', url: '' },
    { name: 'Лаб. каф. физики', head: '—', room: '320', floor: 3, phone: '+7 (4855) 23-97-54', url: '' },
    { name: 'Лаб. каф. материаловедения', head: '—', room: '330', floor: 3, phone: '+7 (4855) 23-97-54', url: '' },
    { name: 'Лаб. каф. механики', head: '—', room: '334', floor: 3, phone: '+7 (4855) 23-97-54', url: '' },
    // 4 этаж
    { name: 'Дирекция ИИТСУ', head: 'Ломанов Алексей Николаевич', room: '426', floor: 4, phone: '+7 (4855) 23-97-59', email: 'itms@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/292/' },
    { name: 'Кафедра экономики, менеджмента и экономических информационных систем', head: 'Камакина Ольга Владимировна', room: '428', floor: 4, phone: '+7 (4855) 23-97-59', url: 'https://www.rsatu.ru/university/struct/292/' },
    { name: 'Кафедра вычислительных систем', head: 'Комаров Валерий Михайлович', room: '430', floor: 4, phone: '+7 (4855) 23-97-59', url: 'https://www.rsatu.ru/university/struct/292/' },
    { name: 'Кафедра мат. и прогр. обеспеч. ЭВС', head: 'Паламарь Ирина Николаевна', room: '432', floor: 4, phone: '+7 (4855) 23-97-59', url: 'https://www.rsatu.ru/university/struct/292/' },
    { name: 'Кафедра электротехники и программируемой радиоэлектроники', head: 'Юдин Алексей Викторович', room: '434', floor: 4, phone: '+7 (4855) 23-97-59', url: 'https://www.rsatu.ru/university/struct/292/' },
    { name: 'Кафедра высшей математики', head: 'Башкин Михаил Анатольевич', room: '420', floor: 4, phone: '+7 (4855) 23-97-59', url: 'https://www.rsatu.ru/university/struct/292/' },
    { name: 'Кафедра иностранных языков', head: 'Петрова Лариса Адольфовна', room: '422', floor: 4, phone: '+7 (4855) 23-97-59', url: 'https://www.rsatu.ru/university/struct/292/' },
    { name: 'Инжиниринговый центр «Цифровое энергомашиностроение»', head: '—', room: '401', floor: 4, phone: '+7 (4855) 23-97-43', url: 'https://www.rsatu.ru/university/struct/328/' },
    { name: 'Центр «Цифровая платформа университета»', head: '—', room: '403', floor: 4, phone: '+7 (4855) 23-97-43', url: 'https://www.rsatu.ru/university/struct/329/' },
    { name: 'Управление научно-исследовательской работы', head: 'Курочкин Антон Валерьевич', room: '405', floor: 4, phone: '+7 (4855) 23-97-43', url: 'https://www.rsatu.ru/university/struct/330/' },
    // 5 этаж
    { name: 'Лаборатория станков и инструментов', head: '—', room: '501', floor: 5, phone: '+7 (4855) 23-97-54', email: 'fad@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Лаборатория сварочных технологий', head: '—', room: '503', floor: 5, phone: '+7 (4855) 23-97-54', email: 'fad@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Лаборатория литейного производства', head: '—', room: '505', floor: 5, phone: '+7 (4855) 23-97-54', email: 'fad@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Лаборатория испытаний авиационных двигателей', head: '—', room: '507', floor: 5, phone: '+7 (4855) 23-97-54', email: 'fad@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Лаборатория электроники и радиоэлектроники', head: '—', room: '509', floor: 5, phone: '+7 (4855) 23-97-59', email: 'itms@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/292/' },
    { name: 'Компьютерный класс (5 этаж)', head: '—', room: '511', floor: 5, phone: '+7 (4855) 23-97-59', email: 'itms@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/292/' },
    { name: 'Серверная', head: '—', room: '513', floor: 5, phone: '+7 (4855) 23-97-43', email: 'sutyagin.an@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/329/' },
    { name: 'Лаборатория оптики и физики', head: '—', room: '515', floor: 5, phone: '+7 (4855) 23-97-54', email: 'fad@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Лаборатория испытания материалов', head: '—', room: '517', floor: 5, phone: '+7 (4855) 23-97-54', email: 'fad@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Лаборатория термодинамики и теплопередачи', head: '—', room: '519', floor: 5, phone: '+7 (4855) 23-97-54', email: 'fad@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Лаборатория САПР (компьютерная графика)', head: '—', room: '521', floor: 5, phone: '+7 (4855) 23-97-54', email: 'fad@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/291/' },
    { name: 'Лаборатория робототехники и автоматизации', head: '—', room: '523', floor: 5, phone: '+7 (4855) 23-97-59', email: 'itms@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/292/' },
    { name: 'Архив / Хранилище', head: '—', room: '527', floor: 5, phone: '+7 (4855) 23-97-35', email: 'golovkin-sm@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/335/' },
    { name: 'Технические помещения', head: '—', room: '529', floor: 5, phone: '+7 (4855) 23-97-35', email: 'golovkin-sm@rsatu.ru', url: 'https://www.rsatu.ru/university/struct/334/' },
    // Авиационный колледж (отдельное здание)
    { name: 'Авиационный колледж', head: 'Попков Кирилл Николаевич', room: '200', floor: 0, phone: '+7 (4855) 28-04-30', email: 'kirpopkov@mail.ru', url: 'https://www.rsatu.ru/university/struct/310/' },
  ];
}

function getDocuments() {
  return [
    { id: 'spravka-status', name: 'Справка о статусе «обучающийся»', category: 'Справки', description: 'Справка, подтверждающая, что вы являетесь студентом РГАТУ. Необходима для банка, военкомата, скидок на проезд, налоговых вычетов и т.д.', steps: ['Обратитесь в ЦРО (Центр по работе с обучающимися, ауд. 203)', 'Напишите заявление на выдачу справки (бланк выдаст сотрудник)', 'Предъявите паспорт', 'Заберите готовую справку на следующий рабочий день'], where: 'ЦРО (Центр по работе с обучающимися)', room: '203', floor: 2, schedule: 'Пн-Пт 8:30-17:30, обед 12:30-13:30', documents: ['Паспорт'], time: '1 рабочий день', price: 'Бесплатно' },
    { id: 'spravka-vyzov', name: 'Справка-вызов на сессию', category: 'Справки', description: 'Справка-вызов для студентов заочного отделения для предоставления по месту работы.', steps: ['Обратитесь в ЦРО (ауд. 203) или ФЗО (ауд. 215)', 'Напишите заявление на выдачу справки-вызова', 'Предъявите паспорт и студенческий билет', 'Заберите справку через 3 рабочих дня'], where: 'ЦРО / ФЗО', room: '203', floor: 2, schedule: 'Пн-Пт 8:30-17:30, обед 12:30-13:30', documents: ['Паспорт', 'Студенческий билет'], time: '3 рабочих дня', price: 'Бесплатно' },
    { id: 'spravka-voenkomat', name: 'Справка для военкомата', category: 'Справки', description: 'Справка для предоставления в военный комиссариат, подтверждающая факт обучения.', steps: ['Обратитесь в ЦРО (ауд. 203)', 'Напишите заявление на выдачу справки для военкомата', 'Предъявите паспорт', 'Получите справку в тот же день'], where: 'ЦРО', room: '203', floor: 2, schedule: 'Пн-Пт 8:30-17:30, обед 12:30-13:30', documents: ['Паспорт', 'Студенческий билет'], time: 'В день обращения', price: 'Бесплатно' },
    { id: 'obhodnoy', name: 'Обходной лист', category: 'Документы об обучении', description: 'Документ, подтверждающий отсутствие задолженностей перед подразделениями университета. Необходим при отчислении, переводе, выпуске.', steps: ['Получите бланк обходного листа в ЦРО (ауд. 203)', 'Пройдите все отметки: библиотека, общежитие, деканат, бухгалтерия и др.', 'Сдайте заполненный обходной лист в ЦРО'], where: 'ЦРО', room: '203', floor: 2, schedule: 'Пн-Пт 8:30-17:30, обед 12:30-13:30', documents: ['Студенческий билет'], time: '3-5 рабочих дней', price: 'Бесплатно' },
    { id: 'akadem', name: 'Академический отпуск', category: 'Справки', description: 'Предоставление академического отпуска по медицинским показаниям или иным обстоятельствам.', steps: ['Подготовьте подтверждающие документы (медицинская справка и др.)', 'Напишите заявление на имя ректора', 'Подайте заявление и документы в ЦРО (ауд. 203)', 'Ожидайте приказа о предоставлении академического отпуска'], where: 'ЦРО', room: '203', floor: 2, schedule: 'Пн-Пт 8:30-17:30, обед 12:30-13:30', documents: ['Заявление', 'Медицинская справка (по мед. показаниям)', 'Студенческий билет', 'Паспорт'], time: 'До 10 рабочих дней', price: 'Бесплатно' },
    { id: 'zachetka-vosst', name: 'Восстановление зачётной книжки', category: 'Документы об обучении', description: 'Выдача дубликата зачётной книжки при утере или порче.', steps: ['Обратитесь в ЦРО (ауд. 203)', 'Напишите заявление о выдаче дубликата зачётной книжки', 'Оплатите пошлину через Сбербанк Онлайн или кассу', 'Предоставьте квитанцию об оплате в ЦРО', 'Получите новую зачётную книжку'], where: 'ЦРО', room: '203', floor: 2, schedule: 'Пн-Пт 8:30-17:30, обед 12:30-13:30', documents: ['Паспорт', 'Студенческий билет', 'Квитанция об оплате'], time: 'До 5 рабочих дней', price: 'Согласно тарифам' },
    { id: 'restore', name: 'Восстановление после отчисления', category: 'Перевод и восстановление', description: 'Процедура восстановления в число обучающихся после отчисления.', steps: ['Напишите заявление о восстановлении на имя ректора', 'Предоставьте документы, подтверждающие устранение причин отчисления', 'Пройдите аттестацию для определения разницы в учебных планах', 'Ожидайте приказа о восстановлении'], where: 'ЦРО / Учебный отдел', room: '203', floor: 2, schedule: 'Пн-Пт 8:30-17:30, обед 12:30-13:30', documents: ['Заявление', 'Паспорт', 'Документ об образовании'], time: 'До 14 рабочих дней', price: 'Бесплатно' },
    { id: 'transfer', name: 'Перевод на другую специальность', category: 'Перевод и восстановление', description: 'Процедура перевода на другую образовательную программу внутри РГАТУ или из другого вуза.', steps: ['Узнайте о наличии вакантных мест на желаемой программе', 'Напишите заявление о переводе на имя ректора', 'Получите справку об обучении с текущего места', 'Пройдите аттестацию (собеседование/тестирование)', 'Ожидайте приказа о переводе'], where: 'Приёмная комиссия / ЦРО', room: '101', floor: 1, schedule: 'Пн-Пт 9:00-18:00, обед 13:00-14:00', documents: ['Заявление', 'Справка об обучении', 'Транскрипт (зачётная книжка)', 'Паспорт'], time: 'До 14 рабочих дней', price: 'Бесплатно' },
    { id: 'diploma-dup', name: 'Дубликат диплома', category: 'Документы об обучении', description: 'Выдача дубликата диплома взамен утраченного или испорченного.', steps: ['Напишите заявление о выдаче дубликата диплома', 'Опубликуйте объявление о признании диплома недействительным', 'Оплатите государственную пошлину', 'Предоставьте документы в отдел администрирования учебного процесса', 'Получите дубликат диплома'], where: 'Отдел администрирования учебного процесса', room: '105', floor: 1, schedule: 'Пн-Пт 9:00-17:00, обед 13:00-14:00', documents: ['Заявление', 'Паспорт', 'Копия объявления', 'Квитанция об оплате'], time: 'До 30 рабочих дней', price: 'Государственная пошлина' },
    { id: 'hostel', name: 'Заселение в общежитие', category: 'Социальные вопросы', description: 'Порядок заселения в студенческое общежитие РГАТУ.', steps: ['Подайте заявление на предоставление места в общежитии', 'Получите направление на заселение в учебном отделе', 'Пройдите медосмотр и получите медсправку', 'Обратитесь к коменданту общежития с направлением и документами', 'Подпишите договор найма жилого помещения', 'Получите ключи и заселитесь'], where: 'Управление имущественным комплексом', room: '104', floor: 1, schedule: 'Пн-Пт 9:00-17:00', documents: ['Заявление', 'Паспорт', 'Студенческий билет', 'Медицинская справка', 'Направление на заселение'], time: 'До 7 рабочих дней', price: 'Согласно тарифам' },
    { id: 'stipendia', name: 'Назначение стипендии', category: 'Социальные вопросы', description: 'Информация о видах стипендий и порядке их назначения.', steps: ['Узнайте критерии назначения стипендии в учебном отделе', 'При необходимости подайте заявление на социальную стипендию', 'Предоставьте справку из соцзащиты (для социальной стипендии)', 'Стипендия назначается приказом по итогам сессии'], where: 'Планово-финансовое управление / ЦРО', room: '102', floor: 1, schedule: 'Пн-Пт 9:00-17:00, обед 13:00-14:00', documents: ['Заявление (для социальной стипендии)', 'Справка из органов соцзащиты'], time: 'Назначается по итогам сессии', price: 'Бесплатно' },
    { id: 'plata', name: 'Оплата обучения', category: 'Финансовые вопросы', description: 'Способы оплаты платного обучения и получения квитанции.', steps: ['Получите реквизиты для оплаты в планово-финансовом управлении', 'Оплатите обучение через Сбербанк Онлайн, QR-код или кассу', 'Сохраните квитанцию об оплате', 'При необходимости — запросите справку об оплате'], where: 'Планово-финансовое управление', room: '102', floor: 1, schedule: 'Пн-Пт 9:00-17:00, обед 13:00-14:00', documents: ['Договор об оказании платных образовательных услуг'], time: 'Мгновенно (при онлайн-оплате)', price: 'Согласно договору' },
    { id: 'raspisanie', name: 'Расписание занятий', category: 'Учебный процесс', description: 'Где найти и как получить расписание занятий.', steps: ['Проверьте расписание на сайте РГАТУ (раздел «Обучающимся» → «Расписание занятий»)', 'Расписание также доступно в ЭИОС (lk.rsatu.ru)', 'При изменениях — уточняйте на кафедре или в учебном отделе'], where: 'Сайт РГАТУ / ЭИОС', room: '—', floor: '—', schedule: 'Круглосуточно онлайн', documents: [], time: 'Мгновенно', price: 'Бесплатно' },
    { id: 'pk', name: 'Обращение в приёмную комиссию', category: 'Поступление', description: 'Как подать документы и связаться с приёмной комиссией РГАТУ.', steps: ['Подайте документы онлайн через priemvuz.ru или лично', 'Позвоните в приёмную комиссию: +7 (4855) 23-97-60', 'Единый контакт: 8 (800) 301-44-55', 'Приходите в ауд. 101 (1 этаж) в часы приёма'], where: 'Приёмная комиссия', room: '101', floor: 1, schedule: 'Пн-Пт 9:00-18:00, обед 13:00-14:00', documents: ['Паспорт', 'Документ об образовании', 'Фотографии 3×4'], time: 'В день обращения', price: 'Бесплатно' },
    { id: 'srochno-vypiska', name: 'Срочная справка об обучении', category: 'Справки', description: 'Срочная выдача справки об обучении (в день обращения).', steps: ['Обратитесь в ЦРО (ауд. 203) до 12:00', 'Напишите заявление на срочную выдачу справки', 'Предъявите паспорт', 'Получите справку в тот же день после обеда'], where: 'ЦРО', room: '203', floor: 2, schedule: 'Пн-Пт 8:30-12:00 (подача), выдача после 13:30', documents: ['Паспорт'], time: 'В день обращения (при подаче до 12:00)', price: 'Бесплатно' },
    { id: 'kvalifikatsiya', name: 'Справка о квалификации (вместо диплома)', category: 'Справки', description: 'Временная справка, подтверждающая наличие квалификации, до выдачи диплома.', steps: ['Обратитесь в отдел администрирования учебного процесса (ауд. 105)', 'Напишите заявление на выдачу справки', 'Предъявите паспорт', 'Получите справку в течение 3 рабочих дней'], where: 'Отдел администрирования учебного процесса', room: '105', floor: 1, schedule: 'Пн-Пт 9:00-17:00, обед 13:00-14:00', documents: ['Паспорт', 'Студенческий билет'], time: '3 рабочих дня', price: 'Бесплатно' },
    { id: 'perevod-zaoch', name: 'Переход на заочное обучение', category: 'Перевод и восстановление', description: 'Процедура перехода с очной формы обучения на заочную.', steps: ['Напишите заявление о переходе на заочную форму на имя ректора', 'Подайте заявление в ЦРО (ауд. 203)', 'Получите согласие декана/директора института', 'Ожидайте приказа о переводе'], where: 'ЦРО / ФЗО', room: '203', floor: 2, schedule: 'Пн-Пт 8:30-17:30, обед 12:30-13:30', documents: ['Заявление', 'Паспорт', 'Студенческий билет'], time: 'До 14 рабочих дней', price: 'Бесплатно' },
    { id: 'material-help', name: 'Материальная помощь', category: 'Социальные вопросы', description: 'Порядок получения материальной помощи для студентов, оказавшихся в трудной жизненной ситуации.', steps: ['Подайте заявление на имя ректора с описанием ситуации', 'Приложите подтверждающие документы (справки, свидетельства)', 'Подайте документы в отдел по воспитательной и социальной работе (каб. 221)', 'Ожидайте решения комиссии'], where: 'Отдел по воспитательной и социальной работе', room: '221', floor: 2, schedule: 'Пн-Пт 9:00-17:00', documents: ['Заявление', 'Подтверждающие документы'], time: 'До 14 рабочих дней', price: 'Бесплатно' },
    { id: 'registratsiya', name: 'Регистрация в ЭИОС (Личный кабинет)', category: 'Учебный процесс', description: 'Как зарегистрироваться в электронной информационно-образовательной среде РГАТУ.', steps: ['Перейдите на lk.rsatu.ru', 'Нажмите «Регистрация»', 'Введите данные: ФИО, номер студенческого билета, email', 'Подтвердите email по ссылке в письме', 'Войдите в систему с логином и паролем'], where: 'Онлайн (lk.rsatu.ru)', room: '—', floor: '—', schedule: 'Круглосуточно', documents: ['Номер студенческого билета', 'Email'], time: 'Мгновенно', price: 'Бесплатно' },
    { id: 'moodle', name: 'Доступ к Moodle (online.rsatu.ru)', category: 'Учебный процесс', description: 'Как получить доступ к системе дистанционного обучения Moodle.', steps: ['Зарегистрируйтесь в ЭИОС (lk.rsatu.ru)', 'Перейдите на online.rsatu.ru', 'Используйте те же логин и пароль, что и в ЭИОС', 'Выберите свои курсы из каталога'], where: 'Онлайн (online.rsatu.ru)', room: '—', floor: '—', schedule: 'Круглосуточно', documents: [], time: 'Мгновенно', price: 'Бесплатно' },
    { id: 'spravka-nalog', name: 'Справка для налогового вычета', category: 'Справки', description: 'Справка для получения социального налогового вычета за обучение.', steps: ['Обратитесь в планово-финансовое управление (каб. 102)', 'Напишите заявление на выдачу справки для налогового вычета', 'Предъявите паспорт и договор об обучении', 'Получите справку с реквизитами оплаты'], where: 'Планово-финансовое управление', room: '102', floor: 1, schedule: 'Пн-Пт 9:00-17:00, обед 13:00-14:00', documents: ['Паспорт', 'Договор об обучении', 'Квитанции об оплате'], time: '3 рабочих дня', price: 'Бесплатно' },
    { id: 'dubl-stud', name: 'Дубликат студенческого билета', category: 'Документы об обучении', description: 'Выдача дубликата студенческого билета при утере или порче.', steps: ['Обратитесь в ЦРО (ауд. 203)', 'Напишите заявление о выдаче дубликата', 'Оплатите пошлину через Сбербанк Онлайн', 'Предоставьте квитанцию об оплате', 'Получите новый студенческий билет'], where: 'ЦРО', room: '203', floor: 2, schedule: 'Пн-Пт 8:30-17:30, обед 12:30-13:30', documents: ['Паспорт', 'Квитанция об оплате'], time: 'До 3 рабочих дней', price: 'Согласно тарифам' },
  ];
}

// ============================================
// Генератор SVG-карт этажей
// ============================================

// Константы компоновки
const ROOM_H = 220;
const CORRIDOR_H = 80;
const STAIRS_W = 60;
const MARGIN_X = 10;
const TOP_Y = 50;
const CORRIDOR_Y = TOP_Y + ROOM_H; // 270
const BOT_Y = CORRIDOR_Y + CORRIDOR_H; // 350
const SVG_H = 680;

const W = {
  narrow: 65, snarrow: 70, std: 80, swstd: 90, wstd: 95,
  med: 110, wide: 120, xwide: 160, toilet: 55, special: 100,
};

// CSS-стили SVG
const SVG_STYLES = `
  .wall{fill:none;stroke:#4a4a4a;stroke-width:3;stroke-linecap:round}
  .inner-wall{fill:none;stroke:#6a6a6a;stroke-width:1.5;stroke-linecap:round}
  .room{fill:#F5F5F5;stroke:#BDBDBD;stroke-width:1;cursor:pointer;transition:fill .2s}
  .room:hover{fill:#EEEEEE}
  .room.active{fill:#E0E0E0;stroke:#757575;stroke-width:2}
  .corridor{fill:#f5f5f5;stroke:#ddd;stroke-width:1}
  .stairs{fill:#e8e8e8;stroke:#aaa;stroke-width:1}
  .toilet{fill:#E0F2F1;stroke:#4DB6AC;stroke-width:1.5;cursor:pointer;transition:fill .2s}
  .toilet:hover{fill:#B2DFDB}
  .toilet.active{fill:#80CBC4;stroke:#00897B;stroke-width:2}
  .special{fill:#FCE4EC;stroke:#F48FB1;stroke-width:1.5;cursor:pointer;transition:fill .2s}
  .special:hover{fill:#F8BBD0}
  .special.active{fill:#F48FB1;stroke:#C2185B;stroke-width:2}
  .service{fill:#fff3e0;stroke:#ffb74d;stroke-width:1}
  .label{font-family:'Segoe UI',Arial,sans-serif;font-size:10px;fill:#333;text-anchor:middle;dominant-baseline:middle;pointer-events:none}
  .room-num{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;fill:#333;text-anchor:middle;dominant-baseline:middle;pointer-events:none;font-weight:700}
  .dept-label{font-family:'Segoe UI',Arial,sans-serif;font-size:7.5px;fill:#555;text-anchor:middle;dominant-baseline:middle;pointer-events:none}
  .floor-label{font-family:'Segoe UI',Arial,sans-serif;font-size:16px;fill:#333;font-weight:800}
  .door{fill:#fff;stroke:#999;stroke-width:1}
  .atif-color{fill:#E3F2FD;stroke:#1565C0;stroke-width:1.5;cursor:pointer;transition:fill .2s}
  .atif-color:hover{fill:#BBDEFB}
  .atif-color.active{fill:#90CAF9;stroke:#1565C0;stroke-width:2}
  .itsu-color{fill:#E8F5E9;stroke:#2E7D32;stroke-width:1.5;cursor:pointer;transition:fill .2s}
  .itsu-color:hover{fill:#C8E6C9}
  .itsu-color.active{fill:#A5D6A7;stroke:#2E7D32;stroke-width:2}
  .ino-color{fill:#F3E5F5;stroke:#6A1B9A;stroke-width:1.5;cursor:pointer;transition:fill .2s}
  .ino-color:hover{fill:#E1BEE7}
  .ino-color.active{fill:#CE93D8;stroke:#6A1B9A;stroke-width:2}
  .lab-color{fill:#FFF8E1;stroke:#F9A825;stroke-width:1.5;cursor:pointer;transition:fill .2s}
  .lab-color:hover{fill:#FFECB3}
  .lab-color.active{fill:#FFD54F;stroke:#F9A825;stroke-width:2}
  .tech-color{fill:#ECEFF1;stroke:#546E7A;stroke-width:1.5;cursor:pointer;transition:fill .2s}
  .tech-color:hover{fill:#CFD8DC}
  .tech-color.active{fill:#B0BEC5;stroke:#546E7A;stroke-width:2}
`;

// Данные этажей: [номер|null, типШирины, cssКласс, dataType, подпись1, подпись2]
const FLOORS = {
  1: {
    label: '1 этаж',
    odd: [
      [99, 'std', 'room', 'service', 'Служба', 'охраны'],
      [101, 'wide', 'room', 'admissions', 'Приёмная', 'комиссия'],
      [103, 'std', 'room', 'service', 'Учеб.-метод.', 'управление'],
      [null, 'special', 'special', 'cloakroom', 'Гардероб', ''],
      [105, 'std', 'room', 'service', 'Центр', 'карьеры'],
      [107, 'wide', 'room', 'leader', 'Ректорат', '(приёмная)'],
      [109, 'snarrow', 'room', 'service', 'Управление', 'учёта'],
      [111, 'snarrow', 'room', 'service', 'Читальный', 'зал'],
      [113, 'wide', 'room', 'service', 'Спортивный', 'зал'],
      [null, 'toilet', 'toilet', 'toilet', 'Туалет', ''],
      [115, 'wide', 'room', 'service', 'Актовый', 'зал'],
      [117, 'std', 'room', 'classroom', 'Аудитория', ''],
      [119, 'std', 'room', 'classroom', 'Аудитория', ''],
      [121, 'std', 'room', 'classroom', 'Аудитория', ''],
      [123, 'std', 'room', 'classroom', 'Аудитория', ''],
    ],
    even: [
      [98, 'std', 'room', 'service', 'Вахта /', 'Охрана'],
      [100, 'wide', 'room', 'service', 'Бухгалтерия', ''],
      [102, 'wide', 'room', 'service', 'Планово-фин.', 'управление'],
      [null, 'toilet', 'toilet', 'toilet', 'Туалет', ''],
      [104, 'wstd', 'room', 'service', 'Упр. имущ.', 'комплексом'],
      [106, 'wstd', 'room', 'service', 'Упр. по кадрам', 'и делопроизв.'],
      [108, 'swstd', 'room', 'service', 'Медпункт', ''],
      [110, 'wide', 'room', 'service', 'Библиотека', ''],
      [112, 'std', 'room', 'service', 'Буфет', ''],
      [114, 'std', 'room', 'classroom', 'Аудитория', ''],
      [116, 'wide', 'room', 'classroom', 'Учеб. отдел', ''],
      [118, 'wide', 'room', 'service', 'Зал', 'заседаний'],
      [120, 'std', 'room', 'classroom', 'Аудитория', ''],
      [122, 'std', 'room', 'classroom', 'Аудитория', ''],
    ],
  },
  2: {
    label: '2 этаж',
    institute_color: 'ino-color',
    odd: [
      [null, 'special', 'special', 'internet-class', 'Интернет-', 'класс'],
      [null, 'special', 'special', 'bibliographers', 'Библиографы', ''],
      [null, 'special', 'special', 'card-catalog', 'Картотека', ''],
      [null, 'xwide', 'special', 'library-fund', 'Библиотечный', 'фонд'],
      [211, 'snarrow', 'room ino-color', 'ino', 'Аудитория', ''],
      [213, 'snarrow', 'room ino-color', 'ino', 'Аудитория', ''],
      [215, 'std', 'room ino-color', 'ino', 'Фак. заочного', 'обучения'],
      [217, 'snarrow', 'room ino-color', 'ino', 'Аудитория', ''],
      [219, 'snarrow', 'room ino-color', 'ino', 'Аудитория', ''],
      [221, 'wide', 'room ino-color', 'ino', 'Проректор по', 'образ. политике'],
      [223, 'wide', 'room ino-color', 'ino', 'Институт', 'непрер. образ.'],
      [225, 'snarrow', 'room ino-color', 'ino', 'Аудитория', ''],
      [227, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [null, 'toilet', 'toilet', 'toilet', 'Туалет', ''],
      [229, 'snarrow', 'room ino-color', 'ino', 'Аудитория', ''],
      [231, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [233, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [235, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [237, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
    ],
    even: [
      [null, 'xwide', 'special', 'reading-room', 'Читальный', 'зал'],
      [206, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [208, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [null, 'toilet', 'toilet', 'toilet', 'Туалет', ''],
      [210, 'xwide', 'room ino-color', 'ino', 'Центр между-', 'народ. сотр.'],
      [212, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [214, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [216, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [218, 'wide', 'room ino-color', 'ino', 'Каф. гуманит.', 'технологий'],
      [220, 'wide', 'room ino-color', 'ino', 'Каф. общест.', 'наук'],
      [222, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [224, 'std', 'room ino-color', 'ino', 'Комп. класс', ''],
      [226, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [228, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [230, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [232, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [234, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
      [236, 'std', 'room ino-color', 'ino', 'Аудитория', ''],
    ],
  },
  3: {
    label: '3 этаж',
    institute_color: 'atif-color',
    odd: [
      [301, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [303, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [305, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [307, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [309, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [311, 'wide', 'room atif-color', 'atif', 'Каф. иннов.', 'машиностроения'],
      [313, 'std', 'room atif-color', 'atif', 'Лаб. каф.', 'иннов. маш.'],
      [315, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [317, 'std', 'room atif-color', 'atif', 'Лаб. каф.', 'авиац. дв.'],
      [319, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [321, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [323, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [325, 'wide', 'room atif-color', 'atif', 'Каф. авиац.', 'двигателей'],
      [327, 'wide', 'room atif-color', 'atif', 'Дирекция', 'ИАТИФ'],
      [329, 'std', 'room atif-color', 'atif', 'Каф. материа-', 'ловедения'],
      [331, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [null, 'toilet', 'toilet', 'toilet', 'Туалет', ''],
      [333, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [335, 'wide', 'room atif-color', 'atif', 'Каф. общей и', 'техн. физики'],
      [337, 'wide', 'room atif-color', 'atif', 'Каф. приклад.', 'механики'],
      [339, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [341, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
      [343, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
    ],
    even: [
      [302, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [304, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [306, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [308, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [310, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [null, 'toilet', 'toilet', 'toilet', 'Туалет', ''],
      [312, 'wide', 'room atif-color', 'atif', 'Лаб. каф.', 'иннов. маш.'],
      [314, 'swstd', 'room atif-color', 'atif', 'Лаб. каф.', 'авиац. дв.'],
      [316, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [318, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [320, 'med', 'room atif-color', 'atif', 'Лаб. каф.', 'физики'],
      [322, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [324, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [326, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [328, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [330, 'med', 'room atif-color', 'atif', 'Лаб. каф.', 'материаловед.'],
      [332, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [334, 'med', 'room atif-color', 'atif', 'Лаб. каф.', 'механики'],
      [336, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [338, 'swstd', 'room atif-color', 'atif', 'Аудитория', ''],
      [340, 'std', 'room atif-color', 'atif', 'Аудитория', ''],
    ],
  },
  4: {
    label: '4 этаж',
    institute_color: 'itsu-color',
    odd: [
      [401, 'wide', 'room itsu-color', 'itsu', 'Инжиниринговый', 'центр'],
      [403, 'wide', 'room itsu-color', 'itsu', 'Центр «Цифр.', 'платформа»'],
      [405, 'std', 'room itsu-color', 'itsu', 'Упр. НИР', ''],
      [407, 'wide', 'room itsu-color', 'itsu', 'Каф. экономики', 'и менеджмента'],
      [409, 'wide', 'room itsu-color', 'itsu', 'Каф. вычислит.', 'систем'],
      [411, 'wide', 'room itsu-color', 'itsu', 'Каф. мат. и прогр.', 'обеспеч. ЭВС'],
      [413, 'wide', 'room itsu-color', 'itsu', 'Каф. электротехн.', 'и радиоэлектр.'],
      [415, 'wide', 'room itsu-color', 'itsu', 'Каф. высшей', 'математики'],
      [417, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [419, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [421, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [423, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [425, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [427, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [null, 'toilet', 'toilet', 'toilet', 'Туалет', ''],
      [429, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [431, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [433, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [435, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
    ],
    even: [
      [402, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [404, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [406, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [408, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [null, 'toilet', 'toilet', 'toilet', 'Туалет', ''],
      [410, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [412, 'std', 'room itsu-color', 'itsu', 'Комп. лаб.', ''],
      [414, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [416, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [418, 'std', 'room itsu-color', 'itsu', 'Аудитория', ''],
      [420, 'wide', 'room itsu-color', 'itsu', 'Каф. высш.', 'математики'],
      [422, 'wide', 'room itsu-color', 'itsu', 'Каф. иностр.', 'языков'],
      [424, 'std', 'room itsu-color', 'itsu', 'Комп. лаб.', ''],
      [426, 'wide', 'room itsu-color', 'itsu', 'Дирекция', 'ИИТСУ'],
      [428, 'wide', 'room itsu-color', 'itsu', 'Каф. экономики', 'и менеджм.'],
      [430, 'wide', 'room itsu-color', 'itsu', 'Каф. вычислит.', 'систем'],
      [432, 'wide', 'room itsu-color', 'itsu', 'Каф. мат. и прогр.', 'обеспеч. ЭВС'],
      [434, 'wide', 'room itsu-color', 'itsu', 'Каф. электротехн.', 'и радиоэлектр.'],
    ],
  },
  5: {
    label: '5 этаж',
    institute_color: 'lab-color',
    odd: [
      [501, 'std', 'room lab-color', 'lab', 'Лаб. станков', 'и инструментов'],
      [503, 'std', 'room lab-color', 'lab', 'Лаб. сварочных', 'технологий'],
      [505, 'std', 'room lab-color', 'lab', 'Лаб. литейного', 'производства'],
      [507, 'std', 'room lab-color', 'lab', 'Лаб. испытаний', 'авиац. двигат.'],
      [509, 'std', 'room lab-color', 'lab', 'Лаб. электроники', 'и радиоэлектр.'],
      [511, 'std', 'room lab-color', 'lab', 'Компьютерный', 'класс'],
      [513, 'std', 'room tech-color', 'tech', 'Серверная', ''],
      [515, 'std', 'room lab-color', 'lab', 'Лаб. оптики', 'и физики'],
      [517, 'std', 'room lab-color', 'lab', 'Лаб. испытания', 'материалов'],
      [519, 'std', 'room lab-color', 'lab', 'Лаб. термодин.', 'и теплопер.'],
      [521, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
      [523, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
      [null, 'toilet', 'toilet', 'toilet', 'Туалет', ''],
      [525, 'std', 'room lab-color', 'lab', 'Лаб. САПР', ''],
      [527, 'std', 'room tech-color', 'tech', 'Архив /', 'Хранилище'],
      [529, 'std', 'room tech-color', 'tech', 'Технические', 'помещения'],
      [531, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
    ],
    even: [
      [500, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
      [502, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
      [504, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
      [506, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
      [508, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
      [null, 'toilet', 'toilet', 'toilet', 'Туалет', ''],
      [510, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
      [512, 'swstd', 'room lab-color', 'lab', 'Комп. класс', ''],
      [514, 'med', 'room tech-color', 'tech', 'Вычислит.', 'центр'],
      [516, 'swstd', 'room lab-color', 'lab', 'Аудитория', ''],
      [518, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
      [520, 'swstd', 'room lab-color', 'lab', 'Лаб. робото-', 'техники'],
      [522, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
      [524, 'swstd', 'room lab-color', 'lab', 'Аудитория', ''],
      [526, 'swstd', 'room lab-color', 'lab', 'Лаб. автомати-', 'зации'],
      [528, 'std', 'room tech-color', 'tech', 'Кладовая /', 'Подсобка'],
      [530, 'std', 'room tech-color', 'tech', 'Технич.', 'помещение'],
      [532, 'std', 'room lab-color', 'lab', 'Аудитория', ''],
    ],
  },
};

function calcTotalWidth(rooms) {
  return rooms.reduce((sum, r) => sum + W[r[1]], 0);
}

function generateStairs(x, y, w, h) {
  const lines = [];
  lines.push(`  <rect x="${x}" y="${y}" width="${w}" height="${h}" class="stairs" rx="3"/>`);
  const cx = x + w / 2;
  const cy = y + h / 2;
  lines.push(`  <text x="${cx}" y="${cy}" class="label" style="font-size:8px;fill:#666" transform="rotate(-90,${cx},${cy})">Лестница</text>`);
  let stepY = y + 40;
  while (stepY < y + h - 20) {
    lines.push(`  <line x1="${x + 5}" y1="${stepY}" x2="${x + w - 5}" y2="${stepY}" stroke="#bbb" stroke-width="0.5"/>`);
    stepY += 30;
  }
  return lines.join('\n');
}

function generateRoom(roomData, x, y, isTop, actualWidth) {
  const [num, wType, cssClass, dataType, label1, label2] = roomData;
  const rw = actualWidth ?? W[wType];
  const rh = ROOM_H;
  const cx = x + rw / 2;
  const cy = y + rh / 2;
  const lines = [];

  // Прямоугольник комнаты
  if (num !== null) {
    lines.push(`  <rect x="${x}" y="${y}" width="${rw}" height="${rh}" class="${cssClass}" data-room="${num}" data-type="${dataType}" rx="2"/>`);
    lines.push(`  <text x="${cx}" y="${cy - 10}" class="room-num">${num}</text>`);
  } else {
    lines.push(`  <rect x="${x}" y="${y}" width="${rw}" height="${rh}" class="${cssClass}" data-type="${dataType}" rx="2"/>`);
  }

  // Подписи
  if (label1) {
    let labelColor = '#555';
    if (cssClass.includes('atif-color')) labelColor = '#1565C0';
    else if (cssClass.includes('itsu-color')) labelColor = '#2E7D32';
    else if (cssClass.includes('ino-color')) labelColor = '#6A1B9A';
    else if (cssClass.includes('lab-color')) labelColor = '#E65100';
    else if (cssClass.includes('tech-color')) labelColor = '#37474F';
    else if (cssClass === 'toilet') labelColor = '#00695C';
    else if (cssClass === 'special') labelColor = '#AD1457';

    const fontSize = (cssClass === 'toilet' || cssClass === 'special') ? '9px' : '7.5px';
    const fontWeight = (num === null) ? ';font-weight:600' : '';

    if (num !== null) {
      if (label2) {
        lines.push(`  <text x="${cx}" y="${cy + 8}" class="dept-label" style="fill:${labelColor};font-size:${fontSize}">${label1}</text>`);
        lines.push(`  <text x="${cx}" y="${cy + 20}" class="dept-label" style="fill:${labelColor};font-size:${fontSize}">${label2}</text>`);
      } else {
        lines.push(`  <text x="${cx}" y="${cy + 12}" class="dept-label" style="fill:${labelColor};font-size:${fontSize}">${label1}</text>`);
      }
    } else {
      if (label2) {
        lines.push(`  <text x="${cx}" y="${cy - 4}" class="dept-label" style="fill:${labelColor};font-size:${fontSize}${fontWeight}">${label1}</text>`);
        lines.push(`  <text x="${cx}" y="${cy + 10}" class="dept-label" style="fill:${labelColor};font-size:${fontSize}${fontWeight}">${label2}</text>`);
      } else {
        lines.push(`  <text x="${cx}" y="${cy}" class="dept-label" style="fill:${labelColor};font-size:${fontSize}${fontWeight}">${label1}</text>`);
      }
    }
  }

  // Дверь
  const doorW = 16, doorH = 5;
  const doorX = cx - doorW / 2;
  const doorY = isTop ? (y + rh - 2) : (y - doorH + 2);
  lines.push(`  <rect x="${doorX}" y="${doorY}" width="${doorW}" height="${doorH}" class="door"/>`);

  return lines.join('\n');
}

function generateFloorSvg(floorNum, floorData, targetRoomsWidth) {
  const oddRooms = floorData.odd;
  const evenRooms = floorData.even;

  // Растягивание комнат чтобы обе стороны заполняли targetRoomsWidth
  const oddTotal = calcTotalWidth(oddRooms);
  const evenTotal = calcTotalWidth(evenRooms);
  const oddStretch = targetRoomsWidth / oddTotal;
  const evenStretch = targetRoomsWidth / evenTotal;

  const oddWidths = oddRooms.map(r => Math.round(W[r[1]] * oddStretch));
  const evenWidths = evenRooms.map(r => Math.round(W[r[1]] * evenStretch));
  // Корректировка последней комнаты
  oddWidths[oddWidths.length - 1] = targetRoomsWidth - oddWidths.slice(0, -1).reduce((a, b) => a + b, 0);
  evenWidths[evenWidths.length - 1] = targetRoomsWidth - evenWidths.slice(0, -1).reduce((a, b) => a + b, 0);

  const roomsWidth = targetRoomsWidth;
  const totalWidth = MARGIN_X + STAIRS_W + roomsWidth + STAIRS_W + MARGIN_X;
  const roomsX = MARGIN_X + STAIRS_W;

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${SVG_H}" width="${totalWidth}" height="${SVG_H}">`);
  lines.push('  <defs>');
  lines.push(`    <style>${SVG_STYLES}    </style>`);
  lines.push('  </defs>');
  lines.push('');
  lines.push(`  <rect width="${totalWidth}" height="${SVG_H}" fill="white"/>`);
  lines.push(`  <text x="20" y="25" class="floor-label">${floorData.label}</text>`);
  lines.push('');

  // Коридор
  lines.push('  <!-- КОРИДОР -->');
  lines.push(`  <rect x="${roomsX}" y="${CORRIDOR_Y}" width="${roomsWidth}" height="${CORRIDOR_H}" class="corridor" rx="2"/>`);
  const corridorCx = roomsX + roomsWidth / 2;
  lines.push(`  <text x="${corridorCx}" y="${CORRIDOR_Y + CORRIDOR_H / 2}" class="label" style="font-size:13px;fill:#aaa">К О Р И Д О Р</text>`);
  lines.push('');

  // Лестницы
  lines.push('  <!-- ЛЕСТНИЦЫ -->');
  const stairsH = ROOM_H * 2 + CORRIDOR_H;
  lines.push(generateStairs(MARGIN_X, TOP_Y, STAIRS_W, stairsH));
  lines.push(generateStairs(roomsX + roomsWidth, TOP_Y, STAIRS_W, stairsH));
  lines.push('');

  // Верхний ряд (нечётные)
  lines.push('  <!-- ВЕРХНИЙ РЯД (НЕЧЁТНЫЕ) -->');
  let curX = roomsX;
  for (let i = 0; i < oddRooms.length; i++) {
    lines.push(generateRoom(oddRooms[i], curX, TOP_Y, true, oddWidths[i]));
    curX += oddWidths[i];
  }
  lines.push('');

  // Нижний ряд (чётные)
  lines.push('  <!-- НИЖНИЙ РЯД (ЧЁТНЫЕ) -->');
  curX = roomsX;
  for (let i = 0; i < evenRooms.length; i++) {
    lines.push(generateRoom(evenRooms[i], curX, BOT_Y, false, evenWidths[i]));
    curX += evenWidths[i];
  }
  lines.push('');

  // Стены
  lines.push('  <!-- СТЕНЫ -->');
  const outerX = MARGIN_X - 2;
  const outerY = TOP_Y - 2;
  const outerW = totalWidth - 2 * MARGIN_X + 4;
  const outerH = ROOM_H * 2 + CORRIDOR_H + 4;
  lines.push(`  <rect x="${outerX}" y="${outerY}" width="${outerW}" height="${outerH}" class="wall" rx="4"/>`);
  lines.push(`  <line x1="${roomsX}" y1="${CORRIDOR_Y}" x2="${roomsX + roomsWidth}" y2="${CORRIDOR_Y}" class="inner-wall"/>`);
  lines.push(`  <line x1="${roomsX}" y1="${BOT_Y}" x2="${roomsX + roomsWidth}" y2="${BOT_Y}" class="inner-wall"/>`);

  // Внутренние стены — нечётные
  curX = roomsX;
  for (let i = 0; i < oddRooms.length; i++) {
    if (i > 0) lines.push(`  <line x1="${curX}" y1="${TOP_Y}" x2="${curX}" y2="${CORRIDOR_Y}" class="inner-wall"/>`);
    curX += oddWidths[i];
  }

  // Внутренние стены — чётные
  curX = roomsX;
  for (let i = 0; i < evenRooms.length; i++) {
    if (i > 0) lines.push(`  <line x1="${curX}" y1="${BOT_Y}" x2="${curX}" y2="${BOT_Y + ROOM_H}" class="inner-wall"/>`);
    curX += evenWidths[i];
  }
  lines.push('');

  lines.push('</svg>');
  return lines.join('\n');
}

function generateAllSvg() {
  console.log('\n🗺️ Генерация SVG-карт...');
  ensureDir(MAPS_DIR);

  // Вычисляем максимальную ширину для одинакового размера всех карт
  let globalMaxRooms = 0;
  for (const floorNum of Object.keys(FLOORS).map(Number).sort((a, b) => a - b)) {
    const fd = FLOORS[floorNum];
    globalMaxRooms = Math.max(globalMaxRooms, calcTotalWidth(fd.odd), calcTotalWidth(fd.even));
  }

  for (const floorNum of Object.keys(FLOORS).map(Number).sort((a, b) => a - b)) {
    const fd = FLOORS[floorNum];
    const svg = generateFloorSvg(floorNum, fd, globalMaxRooms);
    const outPath = path.join(MAPS_DIR, `floor_${floorNum}.svg`);
    saveText(svg, outPath);

    const toilets = [...fd.odd, ...fd.even].filter(r => r[3] === 'toilet').length;
    const specials = [...fd.odd, ...fd.even].filter(r => r[2] === 'special').length;
    const totalW = MARGIN_X + STAIRS_W + globalMaxRooms + STAIRS_W + MARGIN_X;
    console.log(`    ${fd.odd.length} нечётных + ${fd.even.length} чётных, ${toilets} туалетов, ${specials} особых, viewBox=0 0 ${totalW} ${SVG_H}`);
  }
}

// ============================================
// Главная функция
// ============================================

async function main() {
  const startTime = Date.now();
  console.log('════════════════════════════════════════════════════');
  console.log('  Парсер данных РГАТУ им. П.А. Соловьёва v2.0');
  console.log(`  Источник: ${BASE_URL}`);
  console.log(`  Дата: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
  console.log(`  Режим: ${DATA_ONLY ? 'только данные' : SVG_ONLY ? 'только SVG' : 'полный'}`);
  console.log('════════════════════════════════════════════════════');

  // --- Генерация данных ---
  if (!SVG_ONLY) {
    console.log('\n📦 Генерация JSON-данных...');

    // Парсинг с сайта (с fallback)
    const leadership = await parseLeadership();
    saveJson(leadership, 'data_leadership.json');

    const departments = await parseInstitutes();
    saveJson(departments, 'data_departments.json');

    // Статичные данные
    saveJson(getContacts(), 'data_contacts.json');
    saveJson(getDocuments(), 'data_documents.json');
    saveJson(getSubdivisions(), 'data_subdivisions.json');

    // Метаданные
    saveJson({
      lastUpdate: new Date().toISOString(),
      source: BASE_URL,
      version: '2.0.0',
      description: 'Данные получены парсером с официального сайта РГАТУ',
    }, 'data_meta.json');
  }

  // --- Генерация SVG ---
  if (!DATA_ONLY) {
    generateAllSvg();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Парсинг завершён за ${elapsed}с`);
}

main().catch(err => {
  console.error('❌ Критическая ошибка:', err);
  process.exit(1);
});
