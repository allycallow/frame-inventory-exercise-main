# List available commands.
default:
    @just --list

# Build and start the full stack in the foreground.
up:
    docker compose up --build

# Stop and remove the stack's containers and network.
down:
    docker compose down

# Run any Docker Compose command, for example `just compose logs -f backend`.
[positional-arguments]
compose *args:
    docker compose "$@"

# Apply pending Flyway migrations using the backend's database configuration.
migrate:
    docker compose up -d --wait postgres
    docker compose run --build --rm --no-deps backend --spring.main.web-application-type=none
