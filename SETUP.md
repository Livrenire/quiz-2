# Запуск игры: Supabase → GitHub → Vercel

## 1. Supabase (база и реальное время)
1. supabase.com → New project (регион любой, пароль БД сохраните).
2. Слева **SQL Editor → New query**. Откройте файл `supabase/schema.sql`, замените `1234` на свой PIN организатора, вставьте всё в окно и нажмите **Run**. Должно быть «Success».
3. **Project Settings → API**: скопируйте **Project URL** и **anon public key**.
4. Вставьте их в файл `public/config/supabase-config.js`. (anon-ключ публичный по задумке, его можно хранить в GitHub. Никогда не публикуйте service_role.)

## 2. GitHub
Загрузите в репозиторий ВСЁ содержимое этой папки с сохранением структуры:
```
vercel.json
supabase/schema.sql
public/index.html
public/css/style.css
public/js/main.js, logic.js
public/config/supabase-config.js, questions.js, sprites.js
public/assets/computers/team1/idle.png   ← ваш розовый
public/assets/computers/team2/idle.png   ← ваш синий
```

## 3. Vercel
Add New → Project → выберите репозиторий → Framework: **Other**, ничего больше не меняйте (папку `public` Vercel берёт из `vercel.json`) → Deploy.

## 4. Игра
- Участникам отправьте обычную ссылку: `https://ваш-проект.vercel.app`
- Организатор открывает `https://ваш-проект.vercel.app/?admin`, вводит PIN и жмёт **Старт**. Через 5 секунд начнётся вопрос 1 у всех одновременно.
- **Сброс** возвращает всех в ожидание и стирает голоса (для новой игры или теста).

## Что где менять
- Вопросы: `public/config/questions.js` (30 штук, 4 варианта, `correct` — номер верного 0–3).
- Компьютеры, скорость анимации, положение счёта: `public/config/sprites.js`.
- Новые арты: загрузите PNG с теми же именами; если изменился размер или число кадров — поправьте цифры в `sprites.js`.

## Известные ограничения
- Правильные ответы лежат в `questions.js`, который скачивается в браузер, поэтому внимательный участник может их подсмотреть в коде страницы. Для дружеской игры это нормально.
- «Один участник — один голос» держится на идентификаторе в браузере телефона. Очистка данных сайта или другой браузер дают нового участника.
