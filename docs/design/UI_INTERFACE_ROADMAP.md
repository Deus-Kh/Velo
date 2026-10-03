# UI Interface Roadmap

Этот документ фиксирует рабочий roadmap по развитию интерфейса клиента в `chats-client`.

Он дополняет [ROADMAP.md](/c:/Users/User/Projects/chat%203.7/ROADMAP.md), но сфокусирован именно на product UI/UX, visual polish, навигации и user flows.

---

## 1. Цель

Собрать production-ready интерфейс secure messenger, который:

- ощущается цельным продуктом, а не набором экранов
- по плотности и навигационной логике ближе к Telegram
- визуально поддерживает secure-first характер приложения
- масштабируется под дальнейшие фичи без переделки всей UI-архитектуры

---

## 2. Текущий подход

Мы идем итеративно:

1. доводим один крупный UX-блок до хорошего состояния
2. фиксируем результат
3. переходим к следующему экрану или слою
4. после первой волны делаем вторую волну унификации и polish

---

## 3. Основной План

### 3.1 Block 1 - Chat Screen

Status: `Mostly Done`

#### Objective

Сделать `ChatScreen` главным production-ready экраном приложения.

#### Уже сделано

- overlay-открытие чата внутри `MainTabsScreen`
- telegram-like back swipe
- date separators
- улучшенные message bubbles
- время и статусы сообщений
- базовая чистка header и структуры экрана
- telegram-like composer вместо MVP-ввода
- action area рядом с composer
- tap actions по сообщению
- swipe to reply
- полноценный reply flow через `replyTo`, а не через текстовый префикс
- reply preview над composer и quoted block внутри сообщения
- tap по цитате с переходом к исходному сообщению
- `Copy` в message actions
- реальные `presence / last seen / typing` состояния вместо placeholder-статусов
- offline / reconnect / reset-required notices внутри экрана
- более честное disabled/feedback поведение composer при проблемах соединения
- общий header/section/sheet/status pattern после второго design-system pass

#### Осталось сделать

- привести loading / empty / error UX к единому стандарту
- дожать плавность и стабильность swipe/reply interactions
- финально отполировать quoted reply UI и message actions
- при необходимости доработать фон, depth и атмосферу ленты

#### Отложено на потом

- `Message info`
- `Delete for me`

#### Done Criteria

- чат удобно читать и использовать одной рукой
- composer ощущается естественно и компактно
- message actions не выглядят как технический MVP
- жесты, скролл и input не конфликтуют между собой

---

### 3.2 Block 2 - Chat List Screen

Status: `Mostly Done`

#### Objective

Сделать список чатов полноценным home screen продукта.

#### Уже сделано

- базовый `ChatListScreen` как home screen shell
- unread badges
- поиск контактов и запуск нового чата
- realtime refresh списка по новым сообщениям
- long-press menu для диалога
- local pinned chats
- local archived chats
- `Mark as read` из conversation actions
- richer search UX с разделением `Existing Chats / Contacts`
- skeleton / loading states для initial load и search
- более сильная иерархия списка через `Pinned / Chats / Archived`
- общий header/section/status/sheet pattern после второго design-system pass

#### Scope

- unread badges
- pinned chats
- archived chats
- richer search UX
- long press actions
- loading / skeleton / empty states
- лучшее визуальное разделение при сохранении плотности

#### Done Criteria

- экран быстро сканируется взглядом
- понятно, где активные, непрочитанные и важные диалоги
- поиск и запуск нового чата ощущаются естественно

#### Осталось сделать

- сделать последний visual polish списка без крупных функциональных перестроек
- при желании позже заменить local archive/pin на серверную синхронизацию

---

### 3.3 Block 3 - Settings

Status: `Mostly Done`

#### Objective

Превратить `Settings` в сильный secure-product раздел, а не вторичный сервисный экран.

#### Scope

- профиль
- privacy settings
- encryption settings
- trusted contacts / key state
- active sessions / devices
- notifications
- appearance preferences
- понятные human-readable security explanations

#### Уже сделано

- полноценный `SettingsScreen`, а не экран только с logout
- product-like секции: profile / privacy / encryption / devices / account
- local secure state diagnostics
- reset local secure state
- human-readable security summaries
- рабочий `Appearance`
- сохранение theme preference: `system / light / dark`
- сохранение density preference: `compact / comfortable`
- сохранение surface style: `glass / solid`
- применение appearance preferences в клиенте, а не только внутри настроек
- общий header/section/status pattern после второго design-system pass

#### Осталось сделать

- решить, насколько глубоко реализуем `Notifications` как настоящие настройки, а не просто секцию
- при необходимости расширить `Devices & Sessions`
- сделать финальный cross-screen polish, чтобы `Settings` визуально на 100% совпадал с остальным приложением

#### Done Criteria

- пользователь понимает состояние безопасности без чтения техтекста
- важные privacy / security действия доступны без поиска по приложению

---

### 3.4 Block 4 - New Chat And Onboarding

Status: `Mostly Done`

#### Objective

Сделать создание нового чата быстрым, понятным и безопасным по UX.

#### Scope

- recent contacts
- быстрый старт новой беседы
- invite flow
- username / contact / future QR entry points
- trust-first onboarding для secure chat

#### Уже сделано

- отдельный `NewChatScreen` как часть основного shell
- shell из `Chats / New Chat / Settings`
- базовый flow запуска разговора из нового чата
- локальный recent contacts layer
- verified contacts на основе trusted identities
- `New Chat` теперь показывает `Verified Contacts / Recent` до начала поиска
- открытие чата теперь записывает контакт в recent list
- поиск в `New Chat` учитывает trust-state и поднимает verified results выше
- `VerifyContact` связан с `New Chat` как единый trust-first flow
- рабочий invite flow через `Share`
- `Copy ID` для быстрого обмена secure ID
- локальные `Saved Contacts`
- `New Chat` теперь работает как contact hub: `Saved / Verified / Recent / Discover`
- экран показывает ваш secure ID прямо внутри onboarding flow
- общий header/section pattern после второго design-system pass

#### Осталось сделать

- при желании позже добавить отдельные entry points вроде QR / username invite
- сделать последний visual polish `New Chat`, если он будет нужен после общей второй волны

#### Done Criteria

- новый чат создается быстро
- user flow не теряется между поиском, выбором и верификацией
- secure-first логика не перегружает первый вход

---

### 3.5 Block 5 - Design System

Status: `In Progress`

#### Objective

Собрать устойчивую систему визуальных правил для всех экранов.

#### Scope

- spacing tokens
- typography hierarchy
- unified buttons / inputs / badges / surfaces
- glass / blur system
- motion rules
- haptics patterns
- reusable layout templates

#### Уже сделано

- общие `Button` и `Input`
- общие `ScreenHeader` и `SectionEyebrow`
- общие `StatusChip` и `BottomSheetPanel`
- appearance store
- theme preference wiring
- density preference wiring
- surface style wiring
- единый визуальный курс на более плотный messenger-like UI
- общий header/section rhythm уже применен на `Chats / New Chat / Settings / Chat`
- общий chip/sheet pattern уже применен на `Chat / ChatList / Settings`

#### Осталось сделать

- полноценные spacing tokens и typography hierarchy как системный слой
- ~~собрать общий row-pattern для chat/contact/settings~~ — `components/ListRow.tsx` (2026-10-03, roadmap B1): chat list, search, forward picker, New Chat; settings rows остаются на `SettingsRow` до B9
- решить вопрос с реальным blur/glass implementation
- описать и унифицировать motion rules
- добавить reusable layout templates для новых экранов

#### Done Criteria

- новые экраны собираются из повторно используемых паттернов
- UI не расползается по стилю от экрана к экрану
- visual polish масштабируется без ручной доработки каждой детали

---

## 4. Рекомендуемый Порядок Работы

Текущий рекомендуемый порядок:

1. закончить `ChatScreen`
2. перейти к `ChatListScreen`
3. добрать `New Chat` и onboarding
4. сделать финальный проход по `Settings`
5. сделать вторую волну унификации через design system

---

## 5. Принципы UI Реализации

- не раздувать layout без причины
- держать интерфейс плотным и удобным для мессенджера
- избегать лишних декоративных зон и “карточности” там, где нужен живой chat UI
- использовать glass / blur аккуратно, только там, где это усиливает качество восприятия
- при споре между “красиво” и “удобно в ежедневном использовании” выбирать удобство

---

## 6. Ближайший Следующий Шаг

Следующий активный шаг по roadmap:

1. сделать общий row-pattern для chat/contact/settings
2. потом вернуться к оставшимся polish-задачам `ChatScreen`, `ChatList` и `Settings`
3. после этого решить, нужен ли нам еще один visual pass по всему приложению

После этого:

4. при необходимости добавить отложенные message actions и deeper settings flows

---

## 7. Сводка Статуса

- `ChatScreen`: mostly done, остался финальный polish interactions и states
- `ChatListScreen`: mostly done, остался финальный visual/product polish
- `Settings`: mostly done, остались notifications decision и финальный polish
- `New Chat`: mostly done, в основном остался optional polish
- `Design System`: базовый второй слой собран, дальше нужен row-pattern и системное расширение
