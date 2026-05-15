# как обновлять данные

данные лежат в `src/data/` — это обычные json, можно редактировать в любом текстовом редакторе.

## json файлы

### кафедры — `data_departments.json`

```json
{
  "name": "Название института",
  "shortName": "Аббревиатура",
  "address": "Адрес",
  "phone": "Телефон",
  "email": "Email",
  "director": "ФИО директора",
  "directorTitle": "Должность и степень",
  "floor": 3,
  "room": "327",
  "color": "#1565C0",
  "departments": [
    {
      "name": "Название кафедры",
      "head": "ФИО заведующего",
      "headTitle": "Должность и степень",
      "room": "311",
      "floor": 3,
      "phone": "Телефон"
    }
  ]
}
```

### документы — `data_documents.json`

```json
{
  "id": "spravka",
  "name": "Название",
  "category": "Категория",
  "description": "Описание",
  "steps": ["Шаг 1", "Шаг 2"],
  "where": "Где получить",
  "room": "Кабинет",
  "floor": "Этаж",
  "schedule": "Расписание",
  "documents": ["Документ 1"],
  "time": "Срок",
  "price": "Стоимость"
}
```

### остальные

- `data_contacts.json` — контакты универа, приёмки, цро, библиотеки, общаги
- `data_leadership.json` — руководство
- `data_subdivisions.json` — все подразделения по комнатам
- `data_meta.json` — версия данных

## svg карты

карты в `src/maps/floor_1.svg` — `floor_5.svg`.

добавить комнату:
```xml
<rect x="100" y="50" width="100" height="200" class="room atif-color" 
      data-room="339" data-type="new-lab" rx="2"/>
<text x="150" y="140" class="room-num">339</text>
<text x="150" y="160" class="dept-label">Новая лаб.</text>
```

## проверить после изменений

1. `python -m http.server 8080` из папки `src/`
2. открой http://localhost:8080
3. проверь карту, кафедры, документы, контакты
4. проверь поиск

## не забудь

после обновления данных поменяй версию в `src/sw.js`:
```js
const CACHE_NAME = 'rgatu-guide-v15'; // или какая там следующая
```

иначе юзеры будут видеть старые данные из кэша.
