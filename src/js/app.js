// rgatu guide — pwa с картами, поиском, справочником

// глобальное состояние
const App = {
  data: {
    departments: null,
    documents: null,
    contacts: null,
    leadership: null,
    subdivisions: null,
    meta: null,
  },
  state: {
    currentPage: 'home',
    currentFloor: 1,
    activeRoom: null,
    searchTimeout: null,
  },
};

// инит
document.addEventListener('DOMContentLoaded', async () => {
  // сначала меню и поиск — они должны работать даже если рендер сломается
  setupSidebar();
  setupSearch();
  // setupOffline убран — pwa и так работает

  await loadData();

  // try-catch чтобы один сломаный рендер не убил всё
  try { renderPopularDocs(); } catch(e) { console.error('renderPopularDocs:', e); }
  try { renderInstitutes(); } catch(e) { console.error('renderInstitutes:', e); }
  try { renderDocuments(); } catch(e) { console.error('renderDocuments:', e); }
  try { renderContacts(); } catch(e) { console.error('renderContacts:', e); }
  try { renderBellSchedule(); } catch(e) { console.error('renderBellSchedule:', e); }

  // карта первого этажа
  try { await loadFloorMap(1); } catch(e) { console.error('loadFloorMap:', e); }
});

// загрузка данных
async function loadData() {
  const files = [
    { key: 'departments', file: 'data_departments.json' },
    { key: 'documents', file: 'data_documents.json' },
    { key: 'contacts', file: 'data_contacts.json' },
    { key: 'leadership', file: 'data_leadership.json' },
    { key: 'subdivisions', file: 'data_subdivisions.json' },
    { key: 'meta', file: 'data_meta.json' },
  ];

  for (const { key, file } of files) {
    try {
      const resp = await fetch(`data/${file}`);
      if (resp.ok) {
        App.data[key] = await resp.json();
      }
    } catch (e) {
      console.warn(`Не удалось загрузить ${file}:`, e);
    }
  }
}

// навигация
function navigateTo(page) {
  App.state.currentPage = page;

  // прячем все страницы
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // показываем нужную
  const pageEl = document.getElementById(`page${capitalize(page)}`);
  if (pageEl) {
    pageEl.classList.add('active');
    // слайд-анимация, но не для карты
    if (!pageEl.classList.contains('page--map')) {
      pageEl.classList.add('slide-up');
      setTimeout(() => pageEl.classList.remove('slide-up'), 400);
    }
  }

  document.querySelectorAll('.sidebar__link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  closeSidebar();

  // закрываем карточку комнаты
  closeRoomCard();

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // если карта — грузим svg
  if (page === 'map') {
    loadFloorMap(App.state.currentFloor);
  }

  return false;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// боковое меню
function setupSidebar() {
  const btn = document.getElementById('menuBtn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');

  btn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    btn.classList.toggle('active');
  });

  overlay.addEventListener('click', closeSidebar);
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('menuBtn').classList.remove('active');
}

// поиск
function setupSearch() {
  const input = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const results = document.getElementById('searchResults');

  input.addEventListener('input', () => {
    clearTimeout(App.state.searchTimeout);
    App.state.searchTimeout = setTimeout(() => {
      const query = input.value.trim().toLowerCase();
      if (query.length < 2) {
        results.classList.remove('visible');
        results.innerHTML = '';
        return;
      }
      performSearch(query);
    }, 200);
  });

  // кнопка лупы
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const query = input.value.trim().toLowerCase();
      if (query.length >= 2) {
        performSearch(query);
        results.classList.add('visible');
      } else {
        input.focus();
      }
    });
  }

  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) {
      results.classList.add('visible');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.header__search-wrap')) {
      results.classList.remove('visible');
    }
  });
}

function performSearch(query) {
  const results = document.getElementById('searchResults');
  const items = [];

  // кабинеты из подразделений
  if (App.data.subdivisions) {
    App.data.subdivisions.forEach(sub => {
      const room = sub.room || '';
      const name = sub.name || '';
      if (room.toLowerCase().includes(query) || name.toLowerCase().includes(query)) {
        items.push({
          type: 'room',
          title: name,
          meta: room ? `Каб. ${room}, ${sub.floor || '—'} этаж` : `${sub.floor || '—'} этаж`,
          floor: sub.floor,
          room: room,
          subType: sub.type || '',
        });
      }
    });
  }

  // кафедры
  if (App.data.departments) {
    App.data.departments.forEach(inst => {
      inst.departments.forEach(dept => {
        const searchText = `${dept.name} ${dept.head || ''} ${dept.room}`.toLowerCase();
        if (searchText.includes(query)) {
          items.push({
            type: 'dept',
            title: dept.name,
            meta: `${inst.shortName}, каб. ${dept.room}, ${dept.floor} этаж`,
            floor: dept.floor,
            room: dept.room,
            institute: inst.shortName,
          });
        }
      });
      // институт целиком
      if (inst.name.toLowerCase().includes(query) || inst.shortName.toLowerCase().includes(query)) {
        items.push({
          type: 'dept',
          title: inst.name,
          meta: `Дирекция: каб. ${inst.room}, ${inst.floor} этаж`,
          floor: inst.floor,
          room: inst.room,
        });
      }
    });
  }

  // документы
  if (App.data.documents) {
    App.data.documents.forEach(doc => {
      if (doc.name.toLowerCase().includes(query) || doc.category.toLowerCase().includes(query)) {
        items.push({
          type: 'doc',
          title: doc.name,
          meta: doc.category,
          docId: doc.id,
        });
      }
    });
  }

  // руководство
  if (App.data.leadership) {
    App.data.leadership.forEach(leader => {
      if (leader.name.toLowerCase().includes(query) || leader.position.toLowerCase().includes(query)) {
        items.push({
          type: 'person',
          title: leader.name,
          meta: leader.position,
          floor: leader.floor,
          room: leader.room,
        });
      }
    });
  }

  // рендерим результаты
  if (items.length === 0) {
    results.innerHTML = '<div class="search-result-item"><div class="search-result-item__title">Ничего не найдено</div></div>';
  } else {
    results.innerHTML = items.slice(0, 10).map(item => {
      const typeLabels = { room: 'Кабинет', dept: 'Кафедра', doc: 'Документ', person: 'Руководство' };
      return `
        <div class="search-result-item" onclick="handleSearchResult(${JSON.stringify(item).replace(/"/g, '&quot;')})">
          <span class="search-result-item__type search-result-item__type--${item.type}">${typeLabels[item.type]}</span>
          <div class="search-result-item__title">${item.title}</div>
          <div class="search-result-item__meta">${item.meta}</div>
        </div>
      `;
    }).join('');
  }

  results.classList.add('visible');
}

function handleSearchResult(item) {
  document.getElementById('searchResults').classList.remove('visible');
  document.getElementById('searchInput').value = '';

  if (item.type === 'doc') {
    navigateTo('documents');
    setTimeout(() => openDocModal(item.docId), 300);
  } else if (item.type === 'room' || item.type === 'dept' || item.type === 'person') {
    navigateTo('map');
    if (item.floor) {
      setTimeout(async () => {
        await selectFloor(item.floor);
        if (item.room) {
          highlightRoom(item.room);
        } else if (item.subType) {
          highlightSpecialRoom(item.subType);
        }
      }, 200);
    }
  }
}

// карта этажей
async function loadFloorMap(floor) {
  App.state.currentFloor = floor;
  const container = document.getElementById('mapScroll');

  try {
    const resp = await fetch(`maps/floor_${floor}.svg`);
    if (resp.ok) {
      const svgText = await resp.text();
      container.innerHTML = svgText;
      setupMapInteraction();
      initMapZoom();
    } else {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:#999">Карта ${floor} этажа временно недоступна</div>`;
    }
  } catch (e) {
    container.innerHTML = `<div style="padding:40px;text-align:center;color:#999">Ошибка загрузки карты</div>`;
  }
}

function selectFloor(floor) {
  App.state.currentFloor = floor;
  document.querySelectorAll('.floor-tab').forEach(tab => {
    tab.classList.toggle('active', parseInt(tab.dataset.floor) === floor);
  });
  closeRoomCard();
  return loadFloorMap(floor);
}

function setupMapInteraction() {
  const container = document.getElementById('mapScroll');
  const svg = container.querySelector('svg');
  if (!svg) return;

  // клик по комнате/туалету/особому помещению
  const rooms = svg.querySelectorAll('.room[data-room], .toilet, .special');
  rooms.forEach(room => {
    room.addEventListener('click', (e) => {
      e.stopPropagation();
      // снимаем активность
      rooms.forEach(r => r.classList.remove('active'));
      room.classList.add('active');
      const roomId = room.dataset.room || null;
      const roomType = room.dataset.type;
      showRoomCard(roomId, roomType, e);
    });
  });

  // клик на пустое место = закрыть
  svg.addEventListener('click', () => {
    rooms.forEach(r => r.classList.remove('active'));
    closeRoomCard();
  });
}

function highlightRoom(roomId) {
  const container = document.getElementById('mapScroll');
  const svg = container.querySelector('svg');
  if (!svg) return;

  const rooms = svg.querySelectorAll('.room[data-room], .toilet, .special');
  rooms.forEach(r => {
    r.classList.remove('active', 'highlight');
    if (r.dataset.room === roomId) {
      r.classList.add('active');
      r.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // позиция для карточки
      const rect = r.getBoundingClientRect();
      const fakeEvent = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      showRoomCard(r.dataset.room, r.dataset.type, fakeEvent);
    }
  });
}

function highlightSpecialRoom(roomType) {
  const container = document.getElementById('mapScroll');
  const svg = container.querySelector('svg');
  if (!svg) return;

  const rooms = svg.querySelectorAll('.room[data-room], .toilet, .special');
  rooms.forEach(r => {
    r.classList.remove('active', 'highlight');
    if (r.dataset.type === roomType) {
      r.classList.add('active');
      r.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const rect = r.getBoundingClientRect();
      const fakeEvent = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      showRoomCard(null, roomType, fakeEvent);
    }
  });
}

function showRoomCard(roomId, roomType, clickEvent) {
  const card = document.getElementById('roomCard');
  const content = document.getElementById('roomCardContent');
  const backdrop = document.getElementById('roomCardBackdrop');
  const isMobile = window.innerWidth < 600;

  // ищем инфу о комнате
  let roomInfo = findRoomInfo(roomId, roomType);

  const badgeClass = roomInfo.institute === 'АТИФ' || roomInfo.institute === 'ИАТИФ' ? 'atif'
    : roomInfo.institute === 'ИТСУ' || roomInfo.institute === 'ИИТСУ' ? 'itsu'
    : roomInfo.institute === 'ИНО' ? 'ino'
    : roomInfo.institute === 'Лаборатории' ? 'lab'
    : roomInfo.institute === 'Технические помещения' ? 'tech'
    : roomInfo.institute === 'Руководство' ? 'leader'
    : roomInfo.institute === 'Приёмная комиссия' ? 'admissions'
    : roomInfo.institute === 'Аудитория' ? 'classroom'
    : 'service';

  content.innerHTML = `
    <div class="room-card__title">${roomId ? 'Кабинет ' + roomId : roomInfo.name || 'Помещение'}</div>
    <span class="room-card__badge room-card__badge--${badgeClass}">${roomInfo.institute || 'Служебное помещение'}</span>
    <div class="room-card__info">
      ${roomInfo.name ? `<div class="room-card__row"><span class="room-card__row-icon">📋</span><span class="room-card__row-text">${roomInfo.name}</span></div>` : ''}
      ${roomInfo.head ? `<div class="room-card__row"><span class="room-card__row-icon">👤</span><span class="room-card__row-text">${roomInfo.head}</span></div>` : ''}
      ${roomInfo.phone ? `<div class="room-card__row"><span class="room-card__row-icon">📞</span><span class="room-card__row-text"><a href="tel:${roomInfo.phone.replace(/[^0-9+]/g, '')}">${roomInfo.phone}</a></span></div>` : ''}
      ${roomInfo.email ? `<div class="room-card__row"><span class="room-card__row-icon">✉️</span><span class="room-card__row-text"><a href="mailto:${roomInfo.email}">${roomInfo.email}</a></span></div>` : ''}
      <div class="room-card__row"><span class="room-card__row-icon">🏢</span><span class="room-card__row-text">${App.state.currentFloor} этаж</span></div>
    </div>
    ${roomInfo.schedule ? `<div class="room-card__row" style="margin-top:8px"><span class="room-card__row-icon">🕐</span><span class="room-card__row-text">${roomInfo.schedule}</span></div>` : ''}
  `;

  // мобилка — bottom sheet
  if (isMobile) {
    card.classList.add('room-card--bottom');
    // сбрасываем десктопные стили
    card.style.left = '';
    card.style.top = '';
    backdrop.classList.add('visible');
    // клик по подложке = закрыть
    backdrop.onclick = closeRoomCard;
  } else {
    // десктоп — карточка у курсора
    card.classList.remove('room-card--bottom');
    backdrop.classList.remove('visible');
    backdrop.onclick = null;
    if (clickEvent) {
      positionRoomCard(card, clickEvent.clientX, clickEvent.clientY);
    }
  }

  card.classList.add('visible');
  card.classList.remove('hiding');

  if (isMobile) {
    setupBottomSheetSwipe();
  }
}

function positionRoomCard(card, clientX, clientY) {
  // прячем за экраном чтобы измерить
  card.style.left = '-9999px';
  card.style.top = '-9999px';
  card.classList.add('visible');

  const cardRect = card.getBoundingClientRect();
  const cardW = cardRect.width;
  const cardH = cardRect.height;
  card.classList.remove('visible');

  // зона зум-кнопок
  const mapContainer = document.getElementById('mapContainer');
  const containerRect = mapContainer.getBoundingClientRect();
  const zoomControls = document.getElementById('zoomControls');
  const zoomRect = zoomControls.getBoundingClientRect();

  const offset = 12;

  // лучше справа от курсора
  let left = clientX + offset;
  let top = clientY - cardH / 2;

  // не перекрывает ли зум?
  const cardRight = left + cardW;
  const cardBottom = top + cardH;
  const overlapsZoom = (
    cardRight > zoomRect.left &&
    left < zoomRect.right &&
    cardBottom > zoomRect.top &&
    top < zoomRect.bottom
  );

  // перекрывает или не влезает — ставим слева
  if (overlapsZoom || left + cardW > window.innerWidth - 10) {
    left = clientX - cardW - offset;
  }

  // если слева тоже не влезает — справа но ниже зума
  if (left < 10) {
    left = clientX + offset;
    top = zoomRect.bottom + offset;
  }

  // ограничиваем по вертикали
  if (top < 10) top = 10;
  if (top + cardH > window.innerHeight - 10) {
    top = window.innerHeight - cardH - 10;
  }

  // и по горизонтали
  if (left + cardW > window.innerWidth - 10) {
    left = window.innerWidth - cardW - 10;
  }
  if (left < 10) left = 10;

  card.style.left = left + 'px';
  card.style.top = top + 'px';
}

// свайп для закрытия bottom sheet
let _bsSwipeY = 0;
let _bsSwipeActive = false;
let _bsMouseSwipeActive = false;
let _bsMouseSwipeY = 0;

function setupBottomSheetSwipe() {
  const card = document.getElementById('roomCard');
  const handle = card.querySelector('.room-card__handle');
  if (!handle) return;

  _bsSwipeActive = true;

  // убираем старые слушатели
  handle.removeEventListener('touchstart', onBsTouchStart);
  handle.removeEventListener('touchmove', onBsTouchMove);
  handle.removeEventListener('touchend', onBsTouchEnd);
  card.removeEventListener('touchstart', onBsTouchStart);
  card.removeEventListener('touchmove', onBsTouchMove);
  card.removeEventListener('touchend', onBsTouchEnd);
  card.removeEventListener('mousedown', onBsMouseDown);
  window.removeEventListener('mousemove', onBsMouseMove);
  window.removeEventListener('mouseup', onBsMouseUp);

  // тач на ручку и карточку
  handle.addEventListener('touchstart', onBsTouchStart, { passive: true });
  handle.addEventListener('touchmove', onBsTouchMove, { passive: false });
  handle.addEventListener('touchend', onBsTouchEnd);
  card.addEventListener('touchstart', onBsTouchStart, { passive: true });
  card.addEventListener('touchmove', onBsTouchMove, { passive: false });
  card.addEventListener('touchend', onBsTouchEnd);

  // мышь для тестов с пк
  handle.addEventListener('mousedown', onBsMouseDown);
  card.addEventListener('mousedown', onBsMouseDown);
  window.addEventListener('mousemove', onBsMouseMove);
  window.addEventListener('mouseup', onBsMouseUp);
}

function onBsTouchStart(e) {
  if (!_bsSwipeActive) return;
  _bsSwipeY = e.touches[0].clientY;
}

function onBsTouchMove(e) {
  if (!_bsSwipeActive) return;
  const card = document.getElementById('roomCard');
  const dy = e.touches[0].clientY - _bsSwipeY;

  // свайп вниз только если не прокручено (scrollTop <= 0)
  if (dy > 0 && card.scrollTop <= 0) {
    card.style.transform = `translateY(${dy}px)`;
    e.preventDefault(); // чтоб не скроллилось под карточкой
  }
}

function onBsTouchEnd(e) {
  if (!_bsSwipeActive) return;
  const card = document.getElementById('roomCard');
  const currentTransform = card.style.transform;
  const match = currentTransform.match(/translateY\((\d+(?:\.\d+)?)px\)/);
  // порог 40px
  if (match && parseFloat(match[1]) > 40) {
    closeRoomCard();
  } else {
    // возвращаем назад
    card.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    card.style.transform = '';
    // убираем transition после анимации
    setTimeout(() => { card.style.transition = ''; }, 260);
  }
  _bsSwipeY = 0;
}

// мышь (для пк)
function onBsMouseDown(e) {
  if (!_bsSwipeActive) return;
  // только левая кнопка
  if (e.button !== 0) return;
  _bsMouseSwipeActive = true;
  _bsMouseSwipeY = e.clientY;
  e.preventDefault(); // чтоб текст не выделялся
}

function onBsMouseMove(e) {
  if (!_bsMouseSwipeActive) return;
  const card = document.getElementById('roomCard');
  const dy = e.clientY - _bsMouseSwipeY;
  if (dy > 0 && card.scrollTop <= 0) {
    card.style.transform = `translateY(${dy}px)`;
  }
}

function onBsMouseUp(e) {
  if (!_bsMouseSwipeActive) return;
  _bsMouseSwipeActive = false;
  const card = document.getElementById('roomCard');
  const currentTransform = card.style.transform;
  const match = currentTransform.match(/translateY\((\d+(?:\.\d+)?)px\)/);
  if (match && parseFloat(match[1]) > 40) {
    closeRoomCard();
  } else {
    card.style.transition = 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    card.style.transform = '';
    setTimeout(() => { card.style.transition = ''; }, 260);
  }
  _bsMouseSwipeY = 0;
}

function findRoomInfo(roomId, roomType) {
  let info = { name: '', head: '', phone: '', email: '', institute: '', schedule: '' };

  // подразделения
  if (App.data.subdivisions) {
    const sub = App.data.subdivisions.find(s => {
      // по номеру и этажу
      if (roomId && s.room === roomId && s.floor === App.state.currentFloor) return true;
      // без номера — по типу и этажу
      if (!roomId && s.type && s.type === roomType && s.floor === App.state.currentFloor) return true;
      return false;
    });
    if (sub) {
      info.name = sub.name;
      info.head = sub.head || '';
      info.phone = sub.phone || '';
      info.email = sub.email || '';
      info.schedule = sub.schedule || 'Пн-Пт 9:00-17:00';
    }
  }

  // институты и кафедры
  if (App.data.departments) {
    for (const inst of App.data.departments) {
      // дирекция
      if (inst.room === roomId && inst.floor === App.state.currentFloor) {
        info.name = `Дирекция ${inst.shortName}`;
        info.head = inst.director;
        info.phone = inst.phone;
        info.email = inst.email;
        info.institute = inst.shortName;
        info.schedule = 'Пн-Пт 9:00-17:00, обед 13:00-14:00';
        return info;
      }
      // кафедры
      for (const dept of inst.departments) {
        if (dept.room === roomId && dept.floor === App.state.currentFloor) {
          info.name = dept.name;
          info.head = dept.head || '';
          info.phone = dept.phone || inst.phone;
          info.email = inst.email;
          info.institute = inst.shortName;
          info.schedule = 'Пн-Пт 9:00-17:00, обед 13:00-14:00';
          return info;
        }
      }
    }
  }

  // руководство
  if (App.data.leadership) {
    const leader = App.data.leadership.find(l => l.room === roomId && l.floor === App.state.currentFloor);
    if (leader) {
      info.name = leader.position;
      info.head = leader.name;
      info.phone = leader.phone;
      info.email = leader.email;
      info.institute = 'Руководство';
    }
  }

  // определяем институт по этажу/типу
  if (!info.institute) {
    // туалеты
    if (roomType === 'toilet') {
      info.institute = 'Служба';
      info.name = 'Туалет';
      return info;
    }
    // особые помещения
    const specialTypes = {
      'cloakroom': { name: 'Гардероб', institute: 'Служба' },
      'reading-room': { name: 'Читальный зал', institute: 'ИНО' },
      'cro': { name: 'ЦРО (Центр по работе с обучающимися)', institute: 'ИНО' },
      'bibliographers': { name: 'Библиографы', institute: 'ИНО' },
      'card-catalog': { name: 'Картотека', institute: 'ИНО' },
      'library-fund': { name: 'Библиотечный фонд', institute: 'ИНО' },
    };
    if (specialTypes[roomType]) {
      info.name = specialTypes[roomType].name;
      info.institute = specialTypes[roomType].institute;
      return info;
    }
    
    const floor = App.state.currentFloor;
    // по этажу — основной способ
    if (floor === 3) {
      info.institute = 'ИАТИФ';
    } else if (floor === 4) {
      info.institute = 'ИИТСУ';
    } else if (floor === 2) {
      info.institute = 'ИНО';
    } else if (floor === 5) {
      // 5 этаж — лабы
      if (roomType === 'tech') {
        info.institute = 'Технические помещения';
      } else {
        info.institute = 'Лаборатории';
      }
    } else if (floor === 1) {
      // 1 этаж — администрация
      if (roomType === 'admissions') {
        info.institute = 'Приёмная комиссия';
      } else if (roomType === 'leader' || roomType === 'rectorate' || roomType === 'security') {
        info.institute = 'Руководство';
      } else if (roomType === 'classroom') {
        info.institute = 'Аудитория';
      } else {
        info.institute = 'Служба';
      }
    } else {
      info.institute = 'Служба';
    }
  }

  return info;
}

function closeRoomCard() {
  const card = document.getElementById('roomCard');
  const backdrop = document.getElementById('roomCardBackdrop');
  const isMobile = window.innerWidth < 600;

  // мобилка — анимация свайпа
  if (isMobile && card.classList.contains('room-card--bottom')) {
    card.classList.add('hiding');
    card.classList.remove('visible');
    card.style.transform = '';
    backdrop.classList.remove('visible');
    backdrop.onclick = null;
    _bsSwipeActive = false;
    setTimeout(() => {
      card.classList.remove('hiding');
      // не чистить если уже переоткрыли
      if (!card.classList.contains('visible')) {
        document.getElementById('roomCardContent').innerHTML = '';
      }
    }, 350);
  } else {
    card.classList.remove('visible');
    backdrop.classList.remove('visible');
    backdrop.onclick = null;
    _bsSwipeActive = false;
    setTimeout(() => {
      if (!card.classList.contains('visible')) {
        document.getElementById('roomCardContent').innerHTML = '';
      }
    }, 350);
  }

  const container = document.getElementById('mapScroll');
  const svg = container.querySelector('svg');
  if (svg) {
    svg.querySelectorAll('.room.active, .toilet.active, .special.active').forEach(r => r.classList.remove('active'));
  }
}

// институты/кафедры
function renderInstitutes() {
  const container = document.getElementById('institutesList');
  if (!App.data.departments) {
    container.innerHTML = '<p style="color:#999">Данные загружаются...</p>';
    return;
  }

  container.innerHTML = App.data.departments.map((inst, idx) => `
    <div class="institute-card" id="instCard${idx}">
      <div class="institute-card__header" onclick="toggleInstitute(${idx})">
        <div class="institute-card__color" style="background:${inst.color}"></div>
        <div class="institute-card__info">
          <div class="institute-card__name">${inst.name}</div>
          <div class="institute-card__director">${inst.director} — ${inst.directorTitle}</div>
        </div>
        <div class="institute-card__toggle">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div class="institute-card__body">
        <div class="institute-card__contacts">
          <span class="institute-card__contact">📍 каб. ${inst.room}, ${inst.floor} этаж</span>
          <span class="institute-card__contact">📞 ${inst.phone}</span>
          <span class="institute-card__contact">✉️ ${inst.email}</span>
        </div>
        <div class="dept-list">
          ${inst.departments.map(dept => `
            <div class="dept-item" onclick="navigateTo('map');setTimeout(async()=>{await selectFloor(${dept.floor});highlightRoom('${dept.room}')},200)">
              <div class="dept-item__icon" style="color:${inst.color}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
              </div>
              <span class="dept-item__name">${dept.name}</span>
              <span class="dept-item__room">каб. ${dept.room}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

function toggleInstitute(idx) {
  const card = document.getElementById(`instCard${idx}`);
  card.classList.toggle('open');
}

// документы
function renderDocuments() {
  if (!App.data.documents) return;

  const filtersContainer = document.getElementById('docFilters');
  const listContainer = document.getElementById('docsList');

  // уникальные категории
  const categories = [...new Set(App.data.documents.map(d => d.category))];

  filtersContainer.innerHTML = `
    <button class="doc-filter active" data-category="all" onclick="filterDocs('all')">Все</button>
    ${categories.map(cat => `
      <button class="doc-filter" data-category="${cat}" onclick="filterDocs('${cat}')">${cat}</button>
    `).join('')}
  `;

  renderDocsList(App.data.documents);
}

function filterDocs(category) {
  document.querySelectorAll('.doc-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  const docs = category === 'all'
    ? App.data.documents
    : App.data.documents.filter(d => d.category === category);

  renderDocsList(docs);
}

function renderDocsList(docs) {
  const container = document.getElementById('docsList');
  container.innerHTML = docs.map(doc => `
    <div class="doc-card" onclick="openDocModal('${doc.id}')">
      <div class="doc-card__category">${doc.category}</div>
      <div class="doc-card__name">${doc.name}</div>
      <div class="doc-card__desc">${doc.description}</div>
      <div class="doc-card__meta">
        <span class="doc-card__meta-item">📍 ${doc.where}</span>
        <span class="doc-card__meta-item">⏱ ${doc.time}</span>
        <span class="doc-card__meta-item">💰 ${doc.price}</span>
      </div>
    </div>
  `).join('');
}

function openDocModal(docId) {
  const doc = App.data.documents?.find(d => d.id === docId);
  if (!doc) return;

  const modal = document.getElementById('docModal');
  const body = document.getElementById('docModalBody');

  body.innerHTML = `
    <div class="doc-detail__category">${doc.category}</div>
    <div class="doc-detail__name">${doc.name}</div>
    <div class="doc-detail__desc">${doc.description}</div>

    <div class="doc-steps">
      <div class="doc-steps__title">Пошаговая инструкция</div>
      ${doc.steps.map((step, i) => `
        <div class="doc-step">
          <div class="doc-step__num">${i + 1}</div>
          <div class="doc-step__text">${step}</div>
        </div>
      `).join('')}
    </div>

    <div class="doc-info-grid">
      <div class="doc-info-item">
        <div class="doc-info-item__label">Где получить</div>
        <div class="doc-info-item__value">${doc.where}</div>
      </div>
      <div class="doc-info-item">
        <div class="doc-info-item__label">Кабинет / Этаж</div>
        <div class="doc-info-item__value">каб. ${doc.room}, ${doc.floor} этаж</div>
      </div>
      <div class="doc-info-item">
        <div class="doc-info-item__label">Срок</div>
        <div class="doc-info-item__value">${doc.time}</div>
      </div>
      <div class="doc-info-item">
        <div class="doc-info-item__label">Стоимость</div>
        <div class="doc-info-item__value">${doc.price}</div>
      </div>
      <div class="doc-info-item">
        <div class="doc-info-item__label">Расписание</div>
        <div class="doc-info-item__value">${doc.schedule}</div>
      </div>
    </div>

    ${doc.documents && doc.documents.length > 0 ? `
      <div class="doc-documents">
        <div class="doc-documents__title">Необходимые документы:</div>
        <div class="doc-doc-list">
          ${doc.documents.map(d => `<span class="doc-doc-tag">${d}</span>`).join('')}
        </div>
      </div>
    ` : ''}
  `;

  modal.classList.add('visible');
}

function closeDocModal() {
  document.getElementById('docModal').classList.remove('visible');
}

// популярные документы
function renderPopularDocs() {
  const container = document.getElementById('popularDocs');
  if (!App.data.documents) return;

  const popular = App.data.documents.filter(d =>
    ['spravka-status', 'obhodnoy', 'akadem', 'restore', 'zachetka-vosst', 'spravka-vyzov'].includes(d.id)
  );

  container.innerHTML = popular.map(doc => `
    <div class="popular-item" onclick="openDocModal('${doc.id}')">
      <div class="popular-item__icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div class="popular-item__text">
        <div class="popular-item__title">${doc.name}</div>
        <div class="popular-item__meta">${doc.where} · ${doc.time}</div>
      </div>
      <span class="popular-item__arrow">›</span>
    </div>
  `).join('');
}

// расписание звонков
function renderBellSchedule() {
  const container = document.getElementById('bellSchedule');
  const contacts = App.data.contacts;
  if (!contacts || !contacts.bellSchedule) return;

  const bs = contacts.bellSchedule;
  let html = '<h2 class="section-title">Расписание звонков</h2>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
  
  // Будни
  html += '<div style="background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">';
  html += '<div style="font-size:14px;font-weight:700;margin-bottom:8px">Будни</div>';
  bs.weekdays.forEach(p => {
    html += `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px solid #f0f0f0">`;
    html += `<span style="color:#5f6368">${p.pair} пара</span><span style="font-weight:600">${p.time}</span>`;
    html += '</div>';
  });
  html += '</div>';
  
  // Выходные
  html += '<div style="background:white;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08)">';
  html += '<div style="font-size:14px;font-weight:700;margin-bottom:8px">Суббота</div>';
  bs.weekends.forEach(p => {
    html += `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px solid #f0f0f0">`;
    html += `<span style="color:#5f6368">${p.pair} пара</span><span style="font-weight:600">${p.time}</span>`;
    html += '</div>';
  });
  html += '</div>';
  html += '</div>';
  
  container.innerHTML = html;
}

// контакты
function renderContacts() {
  const container = document.getElementById('contactsGrid');
  const contacts = App.data.contacts;
  const leadership = App.data.leadership;

  if (!contacts) return;

  let html = '';

  // универ
  const uni = contacts.university || {};
  html += `
    <div class="contact-card">
      <div class="contact-card__title">Университет</div>
      ${uni.address ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">📍</span>
        <div><div class="contact-card__row-label">Адрес</div><div class="contact-card__row-value">${uni.address}</div></div>
      </div>` : ''}
      ${uni.phone ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">📞</span>
        <div><div class="contact-card__row-label">Телефон</div><div class="contact-card__row-value"><a href="tel:${uni.phone}">${uni.phone}</a></div></div>
      </div>` : ''}
      ${uni.email ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">✉️</span>
        <div><div class="contact-card__row-label">Email</div><div class="contact-card__row-value"><a href="mailto:${uni.email}">${uni.email}</a></div></div>
      </div>` : ''}
      ${uni.website ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">🌐</span>
        <div><div class="contact-card__row-label">Сайт</div><div class="contact-card__row-value"><a href="${uni.website}" target="_blank" rel="noopener">${uni.website}</a></div></div>
      </div>` : ''}
      ${uni.vk || uni.telegram ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">💬</span>
        <div><div class="contact-card__row-label">Соцсети</div>
          <div class="contact-card__row-value">
            ${uni.vk ? `<a href="${uni.vk}" target="_blank" rel="noopener">ВКонтакте</a>` : ''}${uni.vk && uni.telegram ? ' · ' : ''}${uni.telegram ? `<a href="${uni.telegram}" target="_blank" rel="noopener">Telegram</a>` : ''}
          </div>
        </div>
      </div>` : ''}
      ${uni.lk || uni.moodle ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">🖥️</span>
        <div><div class="contact-card__row-label">Личный кабинет / Moodle</div>
          <div class="contact-card__row-value">
            ${uni.lk ? `<a href="${uni.lk}" target="_blank" rel="noopener">lk.rsatu.ru</a>` : ''}${uni.lk && uni.moodle ? ' · ' : ''}${uni.moodle ? `<a href="${uni.moodle}" target="_blank" rel="noopener">online.rsatu.ru</a>` : ''}
          </div>
        </div>
      </div>` : ''}
    </div>
  `;

  // Приёмная комиссия
  const adm = contacts.admissions || {};
  html += `
    <div class="contact-card">
      <div class="contact-card__title">Приёмная комиссия</div>
      ${adm.address ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">📍</span>
        <div><div class="contact-card__row-label">Адрес</div><div class="contact-card__row-value">${adm.address}</div></div>
      </div>` : ''}
      ${adm.phone ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">📞</span>
        <div><div class="contact-card__row-label">Телефон</div><div class="contact-card__row-value"><a href="tel:${adm.phone}">${adm.phone}</a></div></div>
      </div>` : ''}
      ${adm.email ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">✉️</span>
        <div><div class="contact-card__row-label">Email</div><div class="contact-card__row-value"><a href="mailto:${adm.email}">${adm.email}</a></div></div>
      </div>` : ''}
      ${adm.schedule ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">🕐</span>
        <div><div class="contact-card__row-label">Расписание</div><div class="contact-card__row-value">${adm.schedule}</div></div>
      </div>` : ''}
      ${adm.room ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">🏢</span>
        <div><div class="contact-card__row-label">Кабинет</div><div class="contact-card__row-value">каб. ${adm.room}${adm.floor ? ', ' + adm.floor + ' этаж' : ''}</div></div>
      </div>` : ''}
    </div>
  `;

  // ЦРО
  const cro = contacts.cro || {};
  html += `
    <div class="contact-card">
      <div class="contact-card__title">ЦРО (Центр по работе с обучающимися)</div>
      ${cro.address ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">📍</span>
        <div><div class="contact-card__row-label">Адрес</div><div class="contact-card__row-value">${cro.address}</div></div>
      </div>` : ''}
      ${cro.phone ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">📞</span>
        <div><div class="contact-card__row-label">Телефон</div><div class="contact-card__row-value"><a href="tel:${cro.phone}">${cro.phone}</a></div></div>
      </div>` : ''}
      ${cro.email ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">✉️</span>
        <div><div class="contact-card__row-label">Email</div><div class="contact-card__row-value"><a href="mailto:${cro.email}">${cro.email}</a></div></div>
      </div>` : ''}
      ${cro.schedule ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">🕐</span>
        <div><div class="contact-card__row-label">Расписание</div><div class="contact-card__row-value">${cro.schedule}</div></div>
      </div>` : ''}
      ${cro.director ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">👤</span>
        <div><div class="contact-card__row-label">Руководитель</div><div class="contact-card__row-value">${cro.director}</div></div>
      </div>` : ''}
    </div>
  `;

  // Библиотека
  const lib = contacts.library || {};
  const libMain = lib.main || {};
  const libSecond = lib.second || {};
  html += `
    <div class="contact-card">
      <div class="contact-card__title">Библиотека</div>
      ${libMain.address ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">📍</span>
        <div><div class="contact-card__row-label">Главный корпус</div><div class="contact-card__row-value">${libMain.address}${libMain.schedule ? '<br><span style="font-size:12px;color:#5f6368">' + libMain.schedule + '</span>' : ''}</div></div>
      </div>` : ''}
      ${libSecond.address ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">📍</span>
        <div><div class="contact-card__row-label">Второй корпус</div><div class="contact-card__row-value">${libSecond.address}${libSecond.schedule ? '<br><span style="font-size:12px;color:#5f6368">' + libSecond.schedule + '</span>' : ''}</div></div>
      </div>` : ''}
      ${lib.catalog ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">📚</span>
        <div><div class="contact-card__row-label">Электронный каталог</div><div class="contact-card__row-value"><a href="${lib.catalog}" target="_blank" rel="noopener">${lib.catalog}</a></div></div>
      </div>` : ''}
      ${libMain.head ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">👤</span>
        <div><div class="contact-card__row-label">Заведующий</div><div class="contact-card__row-value">${libMain.head}</div></div>
      </div>` : ''}
    </div>
  `;

  // Общежитие
  const dorm = contacts.dormitory || {};
  html += `
    <div class="contact-card">
      <div class="contact-card__title">Общежитие</div>
      ${dorm.address ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">📍</span>
        <div><div class="contact-card__row-label">Адрес</div><div class="contact-card__row-value">${dorm.address}</div></div>
      </div>` : ''}
      ${dorm.phone ? `<div class="contact-card__row">
        <span class="contact-card__row-icon">📞</span>
        <div><div class="contact-card__row-label">Телефон</div><div class="contact-card__row-value"><a href="tel:${dorm.phone}">${dorm.phone}</a></div></div>
      </div>` : ''}
    </div>
  `;

  // Горячие линии
  const hot = contacts.hotlines;
  // берём телефон до длинного тире
  function extractPhone(str) {
    if (!str) return '';
    // бьём по em/en dash но не по дефису (он в номерах телефонов)
    const parts = str.split(/[\u2014\u2013]/);
    return parts[0].trim();
  }
  html += `
    <div class="contact-card">
      <div class="contact-card__title">Горячие линии</div>
      <div class="contact-card__row">
        <span class="contact-card__row-icon">🛡️</span>
        <div><div class="contact-card__row-label">Правовая защита</div><div class="contact-card__row-value"><a href="tel:${extractPhone(hot.legal)}">${hot.legal || ''}</a></div></div>
      </div>
      <div class="contact-card__row">
        <span class="contact-card__row-icon">🧠</span>
        <div><div class="contact-card__row-label">Психологическая помощь</div><div class="contact-card__row-value"><a href="tel:${extractPhone(hot.psychological)}">${hot.psychological || ''}</a></div></div>
      </div>
    </div>
  `;

  // Руководство
  if (leadership && leadership.length > 0) {
    html += `
      <div class="contact-card" style="grid-column: 1 / -1">
        <div class="contact-card__title">Руководство</div>
        <div class="leadership-grid">
          ${leadership.map(leader => `
            <div class="leader-card">
              <div class="leader-card__avatar">${leader.name.charAt(0)}</div>
              <div class="leader-card__info">
                <div class="leader-card__name">${leader.name}</div>
                <div class="leader-card__position">${leader.position}</div>
                <div class="leader-card__contacts">
                  ${leader.phone ? `📞 <a href="tel:${leader.phone}">${leader.phone}</a>` : ''}
                  ${leader.email ? ` · ✉️ <a href="mailto:${leader.email}">${leader.email}</a>` : ''}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// зум и перемещение карты
const MapZoom = {
  svg: null,
  container: null,
  origVB: null,
  scale: 1,
  minScale: 1,
  maxScale: 5,
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  vbStart: { x: 0, y: 0, w: 0, h: 0 },
  lastTouchDist: 0,
};

function initMapZoom() {
  const container = document.getElementById('mapScroll');
  const svg = container.querySelector('svg');
  if (!svg) return;

  MapZoom.svg = svg;
  MapZoom.container = container;
  MapZoom.scale = 1;

  // исходный viewBox
  const vbAttr = svg.getAttribute('viewBox');
  if (vbAttr) {
    const parts = vbAttr.split(' ').map(Number);
    MapZoom.origVB = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }

  // колесо мыши = зум
  container.addEventListener('wheel', onZoomWheel, { passive: false });

  // драг мышью
  container.addEventListener('mousedown', onDragStart);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);

  // тач: пинч-зум и драг
  container.addEventListener('touchstart', onTouchStart, { passive: false });
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('touchend', onTouchEnd);
}

function setViewBox(x, y, w, h) {
  MapZoom.svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
}

function getCurrentVB() {
  const parts = MapZoom.svg.getAttribute('viewBox').split(' ').map(Number);
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

function zoomAtPoint(factor, clientX, clientY) {
  const rect = MapZoom.container.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;

  const cur = getCurrentVB();
  const newW = cur.w / factor;
  const newH = cur.h / factor;

  // лимиты зума
  const newScale = MapZoom.origVB.w / newW;
  if (newScale < MapZoom.minScale || newScale > MapZoom.maxScale) return;

  // точка под курсором в svg-координатах
  const svgX = cur.x + (cx / rect.width) * cur.w;
  const svgY = cur.y + (cy / rect.height) * cur.h;

  // точка остаётся под курсором
  const newX = svgX - (cx / rect.width) * newW;
  const newY = svgY - (cy / rect.height) * newH;

  setViewBox(newX, newY, newW, newH);
  MapZoom.scale = newScale;
}

function onZoomWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  zoomAtPoint(factor, e.clientX, e.clientY);
}

function onDragStart(e) {
  // чтоб текст не выделялся
  e.preventDefault();
  MapZoom.isDragging = true;
  MapZoom.dragStart = { x: e.clientX, y: e.clientY };
  MapZoom.vbStart = getCurrentVB();
  MapZoom.container.style.cursor = 'grabbing';
}

function onDragMove(e) {
  if (!MapZoom.isDragging) return;
  const rect = MapZoom.container.getBoundingClientRect();
  const cur = MapZoom.vbStart;

  const dx = (e.clientX - MapZoom.dragStart.x) / rect.width * cur.w;
  const dy = (e.clientY - MapZoom.dragStart.y) / rect.height * cur.h;

  setViewBox(cur.x - dx, cur.y - dy, cur.w, cur.h);
}

function onDragEnd() {
  MapZoom.isDragging = false;
  if (MapZoom.container) MapZoom.container.style.cursor = 'grab';
}

function onTouchStart(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const t1 = e.touches[0], t2 = e.touches[1];
    MapZoom.lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  } else if (e.touches.length === 1) {
    // драг всегда — карта может не влезать
    MapZoom.isDragging = true;
    MapZoom.dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    MapZoom.vbStart = getCurrentVB();
  }
}

function onTouchMove(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const t1 = e.touches[0], t2 = e.touches[1];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const center = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };

    if (MapZoom.lastTouchDist > 0) {
      const factor = dist / MapZoom.lastTouchDist;
      zoomAtPoint(factor, center.x, center.y);
    }
    MapZoom.lastTouchDist = dist;
  } else if (e.touches.length === 1 && MapZoom.isDragging) {
    const rect = MapZoom.container.getBoundingClientRect();
    const cur = MapZoom.vbStart;
    const dx = (e.touches[0].clientX - MapZoom.dragStart.x) / rect.width * cur.w;
    const dy = (e.touches[0].clientY - MapZoom.dragStart.y) / rect.height * cur.h;
    setViewBox(cur.x - dx, cur.y - dy, cur.w, cur.h);
  }
}

function onTouchEnd() {
  MapZoom.isDragging = false;
  MapZoom.lastTouchDist = 0;
}

function zoomIn() {
  const rect = MapZoom.container.getBoundingClientRect();
  zoomAtPoint(1.3, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function zoomOut() {
  const rect = MapZoom.container.getBoundingClientRect();
  zoomAtPoint(1 / 1.3, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function zoomReset() {
  if (!MapZoom.origVB) return;
  const o = MapZoom.origVB;
  setViewBox(o.x, o.y, o.w, o.h);
  MapZoom.scale = 1;
}

// service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        console.log('SW зарегистрирован:', reg.scope);
        // проверяем апдейты
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              // новый sw активирован, применится при след заходе
              console.log('SW обновлён, применится при следующем заходе');
            }
          });
        });
        // форсируем проверку обновы
        reg.update();
      })
      .catch(err => console.warn('SW ошибка:', err));
  });
}

// pwa install баннер
// localStorage + getInstalledRelatedApps чтобы не показывать после установки
(function() {
  let deferredPrompt = null;
  const banner = document.getElementById('installBanner');
  const installBtn = document.getElementById('installBtn');
  const closeBtn = document.getElementById('installClose');

  // localStorage может быть заблокирован в приватном режиме
  function lsGet(key) { try { return localStorage.getItem(key); } catch(e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); } catch(e) {} }
  function lsRemove(key) { try { localStorage.removeItem(key); } catch(e) {} }

  // если standalone — баннер не нужен, пишем флаг
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    lsSet('pwa_installed', 'true');
    return;
  }

  // ios safari — нет beforeinstallprompt
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  // проверка установлено ли pwa
  async function isPWAInstalled() {
    // standalone = точно установлено
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
      return true;
    }

    // localStorage — самый надёжный способ
    if (lsGet('pwa_installed') === 'true') {
      // проверяем getInstalledRelatedApps — помогает найти удаление
      if ('getInstalledRelatedApps' in navigator) {
        try {
          const apps = await navigator.getInstalledRelatedApps();
          if (apps.some(app => app.platform === 'webapp')) {
            // всё ещё установлено, ок
            return true;
          } else {
            // ls стоит но pwa нет — удалили, сбрасываем
            lsRemove('pwa_installed');
            return false;
          }
        } catch (err) {
          // api сломалось — верим ls
          return true;
        }
      }
      // api нет — верим ls
      return true;
    }

    // getInstalledRelatedApps без ls — вдруг установили в другой вкладке
    if ('getInstalledRelatedApps' in navigator) {
      try {
        const apps = await navigator.getInstalledRelatedApps();
        if (apps.some(app => app.platform === 'webapp')) {
          // установлено но ls пустой — исправляем
          lsSet('pwa_installed', 'true');
          return true;
        }
      } catch (err) { /* игнорируем */ }
    }

    return false;
  }

  // показываем баннер только если pwa не установлено
  async function showBannerIfNotInstalled() {
    const installed = await isPWAInstalled();
    if (!installed && banner) {
      banner.classList.add('visible');
    }
  }

  // перехватываем промпт установки
  // хром/едг могут вызывать это даже после установки, проверяем
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showBannerIfNotInstalled();
  });

  // ios фоллбэк
  setTimeout(async () => {
    if (isIOS && banner && !banner.classList.contains('visible')) {
      const installed = await isPWAInstalled();
      if (!installed) {
        installBtn.textContent = 'Как установить';
        const spanEl = banner.querySelector('span');
        if (spanEl) spanEl.textContent = 'Нажмите  → «На экран Домой»';
        banner.classList.add('visible');
      }
    }
  }, 3000);

  // кнопка установить
  if (installBtn) {
    installBtn.addEventListener('click', () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((result) => {
          console.log('PWA install:', result.outcome);
          deferredPrompt = null;
          if (banner) banner.classList.remove('visible');
        });
      } else if (isIOS) {
        alert('Чтобы установить приложение:\n\n1. Нажмите кнопку «Поделиться» (квадрат со стрелкой внизу экрана)\n2. Выберите «На экран "Домой"»\n3. Нажмите «Добавить»');
      }
    });
  }

  // кнопка закрыть
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (banner) banner.classList.remove('visible');
    });
  }

  // установили — пишем флаг, прячем баннер
  window.addEventListener('appinstalled', () => {
    lsSet('pwa_installed', 'true');
    deferredPrompt = null;
    if (banner) banner.classList.remove('visible');
  });
})();

// поворот экрана / ресайз
let _prevIsMobile = window.innerWidth < 600;
window.addEventListener('resize', () => {
  const isMobile = window.innerWidth < 600;
  const card = document.getElementById('roomCard');
  const backdrop = document.getElementById('roomCardBackdrop');

  // карточка видима и сменился режим — закрываем
  if (card.classList.contains('visible') && isMobile !== _prevIsMobile) {
    closeRoomCard();
  }
  _prevIsMobile = isMobile;
});
