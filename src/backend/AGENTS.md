# AGENTS.md - Java Spring Boot & gRPC Development Guidelines

Behavioral and architectural guidelines to reduce common LLM coding mistakes while strictly enforcing **SOLID principles**, Spring Boot + gRPC best practices, and clean code standards.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

* State your assumptions explicitly. If uncertain, ask.
* If multiple interpretations exist, present them — don't pick silently.
* If a simpler approach exists, say so. Push back when warranted.
* If something is unclear (e.g., `.proto` contract changes, transaction boundaries, or domain invariants), stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

* No features or RPC endpoints beyond what was asked.
* No abstractions or Strategy interfaces for single-use code (apply OCP when variation actually exists or is requested).
* No "flexibility" or "configurability" that wasn't requested.
* No defensive `try-catch` blocks or error handling for impossible scenarios.
* If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

* Don't "improve" adjacent code, comments, or formatting.
* Don't refactor things that aren't broken.
* Match existing style, even if you'd do it differently.
* If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

* Remove imports, variables, fields, or private methods that YOUR changes made unused.
* Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

* "Add validation" → "Write tests for invalid inputs, then make them pass"
* "Fix the bug" → "Write a test that reproduces it, then make it pass"
* "Refactor X" → "Ensure unit and gRPC integration tests pass before and after"

For multi-step tasks, state a brief plan:
[Step] → verify: [check]
[Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Tech Stack & Conventions

* **Language:** Java 21+ (Prefer `record` for immutable domain DTOs/commands, pattern matching, and modern standard library features).
* **Framework:** Spring Boot 3.4+ with **Spring gRPC** (`org.springframework.grpc:spring-grpc-spring-boot-starter`).
* **Serialization / RPC:** Protocol Buffers (`proto3`) & gRPC.
* **Build Tool:** Maven or Gradle (Respect existing project configuration and `protobuf` compiler plugins).
* **Dependency Injection:** **ALWAYS** use Constructor Injection. Field injection (`@Autowired` on fields) is strictly forbidden.
* **Null Safety:** Avoid returning `null` from methods. Use `Optional<T>` for repository/service lookups that may not yield a result, and use `@NonNull` / `@Nullable` annotations where appropriate.

## 6. Build, Protobuf & Test Commands

Use these standard commands to compile Protobuf definitions and verify changes:

* **Maven:**
  * Compile Protobuf stubs: `./mvnw protobuf:compile protobuf:compile-custom`
  * Run unit & integration tests: `./mvnw test`
  * Run a single test class: `./mvnw test -Dtest=ClassName`
* **Gradle:**
  * Compile Protobuf stubs: `./gradlew generateProto`
  * Run unit & integration tests: `./gradlew test`
  * Run a single test class: `./gradlew test --tests "*ClassName"`

## 7. SOLID Principles in Spring Boot & gRPC

### S — Single Responsibility Principle (SRP)

*A class should have one, and only one, reason to change.*

* **gRPC Adapters (`*ImplBase` subclasses) & Controllers:** Responsible *only* for handling transport concerns—unwrapping and validating incoming Protobuf messages (or HTTP requests), delegating to an application service/use case, mapping the domain result back to a Protobuf response, and completing the `StreamObserver` (`onNext()` / `onCompleted()`). Never put business logic or direct repository calls in a gRPC service implementation.
* **Services (`@Service`):** Contain pure business logic and transaction boundaries (`@Transactional`). Break down large "God Services" into smaller, cohesive, domain-focused services or use cases.
* **Repositories (`@Repository`):** Responsible *only* for data persistence and retrieval. Do not include business rules in custom queries or repository implementations.
* **Mappers:** Use dedicated mapper classes or MapStruct to convert between Protobuf messages, Domain models, and JPA Entities. Do not bloat entities, stubs, or services with mapping logic.

### O — Open/Closed Principle (OCP)

*Software entities should be open for extension, but closed for modification.*

* **Strategy Pattern with Spring DI:** When multiple implementations or business rule variants exist (e.g., payment processing, notification channels, discount calculations), avoid large `if-else` or `switch` statements. Define a common interface and inject a `List<StrategyInterface>` or `Map<String, StrategyInterface>` via Spring's dependency injection to resolve implementations dynamically.
* **gRPC Interceptors (`ServerInterceptor`):** Handle cross-cutting transport concerns (authentication, logging, distributed tracing, and global exception-to-`io.grpc.Status` translation) via Spring-managed `ServerInterceptor` beans rather than repetitive `try-catch` blocks inside RPC methods.
* **Domain Events:** Use Spring's `ApplicationEventPublisher` and `@EventListener` (or `@TransactionalEventListener`) to decouple side effects (e.g., sending an email after user registration) from core business flows.

### L — Liskov Substitution Principle (LSP)

*Subtypes must be substitutable for their base types without altering the correctness of the program.*

* **Contract Adherence:** Implementations of an interface must honor the expected behavior, preconditions, and postconditions of the interface.
* **No Unsupported Operations:** Never implement an interface method by throwing `UnsupportedOperationException`. If a class cannot fulfill the entire interface contract, the interface is too broad (see ISP).
* **Exception Consistency:** Subclasses or interface implementations should not throw unexpected checked or runtime exceptions that violate the caller's expectations of the base type.

### I — Interface Segregation Principle (ISP)

*Clients should not be forced to depend upon interfaces that they do not use.*

* **Focused `.proto` Contracts:** Keep gRPC service definitions granular and domain-aligned (e.g., `UserQueryService`, `UserCommandService`) rather than monolithic `.proto` files with dozens of unrelated RPCs.
* **Role-Specific Java Interfaces:** Avoid bloated Java interfaces. Split them into focused interfaces based on client needs (e.g., `UserQueryUseCase`, `UserRegistrationUseCase`).
* **Repository Interfaces:** Do not blindly extend `JpaRepository` if a consumer only needs read access. Consider defining custom base repository interfaces (e.g., `ReadOnlyRepository<T, ID>`) exposing only `findById` and `findAll`.

### D — Dependency Inversion Principle (DIP)

*High-level modules should not depend on low-level modules. Both should depend on abstractions.*

* **Strict Boundary Isolation (Protobuf & JPA):** Never leak generated Protobuf classes (`*Request`, `*Response`) or JPA `@Entity` classes into the core `application` or `domain` layers. Map both Protobuf messages and JPA Entities to/from pure Java domain models (`record` or domain classes) at the outer adapter boundaries.
* **Depend on Abstractions:** Core domain/business services must depend on interfaces (ports) rather than concrete infrastructure classes (adapters) like external gRPC stubs (`*BlockingStub`), REST clients, or third-party SDKs.

## 8. gRPC & Protocol Buffers Guidelines

* **Contract-First Development:** Place all `.proto` definitions in `src/main/proto/` organized by domain and version (e.g., `src/main/proto/user/v1/user.proto`).
* **Proto Options:** Always include `option java_multiple_files = true;` and a clear `option java_package = "...";` so generated classes are clean and modular. Never manually modify generated Java stub files under `target/generated-sources/` or `build/generated/`.
* **Protobuf Defaults & Presence:** Remember that `proto3` scalar fields default to zero-values (`0`, `""`, `false`) and cannot be `null`. Use the `optional` keyword or wrapper types in `.proto` when distinguishing between unset and default values is required by business logic.
* **Error Mapping:** Throw domain-specific exceptions in the service layer (e.g., `ResourceNotFoundException`, `InvalidArgumentDomainException`) and translate them centrally into appropriate `io.grpc.Status` codes (`Status.NOT_FOUND`, `Status.INVALID_ARGUMENT`, etc.) at the gRPC interceptor/advice boundary.

## 9. Recommended Package Structure

Organize packages by **feature/domain** using Hexagonal / Clean Architecture boundaries so transport (gRPC/REST) and persistence remain completely decoupled from business logic:

```text
src/main
├── proto
│   └── feature/v1              # .proto contract definitions
└── java/com/example/project
    ├── common                  # Shared utilities, interceptors, base configs
    │   ├── grpc                # Global gRPC ServerInterceptors & Status exception mappers
    │   └── config              # Security, gRPC, and Jackson configurations
    └── feature                 # e.g., order, user, payment
        ├── adapter             # Inbound & Outbound Adapters
        │   ├── in.grpc         # gRPC *ImplBase services & Protobuf Mappers
        │   ├── in.web          # (Optional) @RestController & HTTP DTOs
        │   └── out.persistence # JPA Entities, Spring Data Repositories, Entity Mappers
        ├── application         # @Service classes, Use Case implementations, Event Listeners
        └── domain              # Pure Java Domain Models, Records, Ports (Interfaces), Domain Exceptions
```

## 10. Coding Standards & Transactions

* **Transactions:** Place `@Transactional` on application service methods that modify state. Use `@Transactional(readOnly = true)` for query-only service methods to optimize database performance.
* **Validation:** Validate incoming Protobuf requests immediately at the gRPC adapter boundary (or via `protovalidate` / custom validators) before invoking domain use cases. Enforce business invariants inside domain models.
* **Immutability:** Prefer `final` fields in all Spring beans and use Java `record` types for all internal commands, queries, domain value objects, and `@ConfigurationProperties`.

## 11. Testing Requirements

### Unit & Persistence Tests

* **Unit Tests:** Every new `@Service` and domain component must have fast, isolated unit tests using **JUnit 5** and **Mockito** (no Spring context or gRPC server loaded).
* **Persistence Tests:** Use `@DataJpaTest` and **Testcontainers** for repository integration tests requiring a real database.
* **Assertions:** Prefer **AssertJ** (`assertThat(...)`) over standard JUnit assertions for better readability.

### gRPC Integration Testing (`@AutoConfigureInProcessTransport`)

* **In-Process Transport:** Annotate gRPC integration tests with `@SpringBootTest` and `@AutoConfigureInProcessTransport` to run the Spring gRPC server in-memory without binding to a network port.
* **Channel & Stub Wiring:** Inject `GrpcChannelFactory` into tests to create channels (`channels.createChannel("local")`) and wrap them with generated `*BlockingStub` clients.
* **Full Pipeline Coverage:** Do not call `*ImplBase` methods directly in integration tests. Always invoke RPCs through a gRPC stub so Protobuf serialization, `ServerInterceptor`s, and exception-to-`io.grpc.Status` mapping are verified end-to-end.
* **Error Assertions:** Assert gRPC error responses using `assertThrows(StatusRuntimeException.class, ...)` and verify both `ex.getStatus().getCode()` and `ex.getStatus().getDescription()`.

#### Reference Test Pattern

```java
@SpringBootTest
@AutoConfigureInProcessTransport
class UserGrpcIntegrationTest {

    @Autowired
    private GrpcChannelFactory channels;

    @Test
    void shouldReturnUser_whenValidIdProvided() {
        var stub = UserServiceGrpc.newBlockingStub(channels.createChannel("local"));

        UserResponse response = stub.getUser(
            GetUserRequest.newBuilder().setId("123").build()
        );

        assertThat(response.getName()).isEqualTo("Alice");
    }

    @Test
    void shouldReturnNotFoundStatus_whenUserDoesNotExist() {
        var stub = UserServiceGrpc.newBlockingStub(channels.createChannel("local"));

        StatusRuntimeException ex = assertThrows(StatusRuntimeException.class, () ->
            stub.getUser(GetUserRequest.newBuilder().setId("missing").build())
        );

        assertThat(ex.getStatus().getCode()).isEqualTo(Status.Code.NOT_FOUND);
    }
}
```

---

**These guidelines are working if:** diffs contain fewer unnecessary changes, fewer rewrites occur due to misunderstood requirements, and clarifying questions happen before implementation rather than after mistakes.

## 12. Agent Execution Checklist

Before finalizing any code generation or modification, verify:

1. [ ] Are all dependencies injected via `private final` fields and a constructor?
2. [ ] Are generated Protobuf classes (`*Request`, `*Response`) and JPA `@Entity` classes completely isolated from the `domain` and `application` layers?
3. [ ] Are gRPC `*ImplBase` classes kept thin, delegating all business rules to application interfaces?
4. [ ] Are exceptions translated to `io.grpc.Status` centrally rather than via repetitive `try-catch` blocks in every RPC method?
5. [ ] Did you avoid speculative abstractions and only touch files directly required by the task?
6. [ ] Are unit tests and `@AutoConfigureInProcessTransport` gRPC stub integration tests included for all new endpoints and business logic?