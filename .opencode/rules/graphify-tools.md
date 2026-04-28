# Graphify Knowledge Graph Tools

Priority: HIGH

## Purpose

Агенты должны использовать graphify tool'ы для поиска информации в графе знаний перед чтением файлов или поиском по коду.

## Available Tools

| Tool | Description |
|------|-------------|
| `graphify_query_graph` | Поиск в графе знаний (BFS/DFS) |
| `graphify_get_node` | Получить детали узла |
| `graphify_get_neighbors` | Соседи узла |
| `graphify_get_community` | Сообщество узлов |
| `graphify_god_nodes` | Самые связанные узлы |
| `graphify_graph_stats` | Статистика графа |
| `graphify_shortest_path` | Кратчайший путь между узлами |

## Skill

`graphify` — обёртка над tool'ами. Активируется через `/graphify`.

## Workflow

1. Если запрос касается информации о коде, архитектуре, модулях → сначала использовать `graphify_query_graph`
2. Если нужен конкретный узел → `graphify_get_node`
3. Если нужно найти связи → `graphify_get_neighbors`
4. Если вопрос о сообществе узлов → `graphify_get_community`
5. Если нужен кратчайший путь между двумя узлами → `graphify_shortest_path`

## Rationale

Graphify содержит структурированную информацию о проекте: узлы, связи, сообщества. Это эффективнее поиска по файлам для понимания архитектуры и зависимостей.

---

*Это правило загружается автоматически через opencode.json rules.*
