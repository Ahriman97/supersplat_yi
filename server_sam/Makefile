Makefile

.PHONY: up down build test logs

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

test:
	bash tests/test_smoke.sh

logs:
	docker compose logs -f sam-server
help:
	@echo "Доступные команды:"
	@echo "  make build   - собрать образ"
	@echo "  make up      - запустить сервер"
	@echo "  make down    - остановить сервер"
	@echo "  make test    - прогнать smoke-тест"
	@echo "  make logs    - смотреть логи"