# Doomwatch Java SDK

Official Java / JVM SDK for the **Doomwatch** distributed tracing and observability platform.

## Features

* **Zero-Touch Context Propagation**: Automatic ambient context management backed by `ThreadLocal`.
* **W3C Trace Context Compliant**: Fully compliant with W3C `traceparent` (`00-{trace_id}-{span_id}-{flags}`) with automatic fallback to legacy `x-tracing-id`.
* **Framework Middlewares**:
  * **Jakarta / Spring Boot Filter (`DoomwatchServletFilter`)**: Intercepts incoming HTTP requests, records `SERVER` spans, and injects continuation headers into responses.
  * **Spring `RestTemplate` Interceptor (`DoomwatchRestTemplateInterceptor`)**: Automatically injects trace headers and tracks outbound client calls.
  * **Java Standard HttpClient Instrumenter (`DoomwatchHttpClientHelper`)**: Interceptor for Java 11+ `java.net.http.HttpClient`.
* **Data Sanitization & Redaction**: Built-in recursive redaction of sensitive credentials (`password`, `authorization`, `token`, `secret`, `api_key`, `cookie`, `credit_card`) and byte truncation.
* **Non-Blocking Fail-Open Exporter**: Background daemon thread that batches and flushes spans asynchronously via built-in `java.net.http.HttpClient` without slowing down or crashing your application.

---

## Installation

Add to your `pom.xml`:

```xml
<dependency>
    <groupId>io.doomwatch</groupId>
    <artifactId>doomwatch-java</artifactId>
    <version>0.1.0</version>
</dependency>
```

Or Gradle:

```groovy
implementation 'io.doomwatch:doomwatch-java:0.1.0'
```

---

## Quickstart

### 1. Initialize Doomwatch

```java
import io.doomwatch.Doomwatch;
import io.doomwatch.DoomwatchConfig;

Doomwatch.init(DoomwatchConfig.builder("order-service")
    .collectorUrl("http://localhost:4000")
    .build());
```

### 2. Spring Boot / Servlet Filter Registration

Register the `DoomwatchServletFilter` to trace incoming HTTP requests:

```java
import io.doomwatch.Doomwatch;
import io.doomwatch.servlet.DoomwatchServletFilter;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TracingConfig {

    @Bean
    public FilterRegistrationBean<DoomwatchServletFilter> doomwatchFilter() {
        FilterRegistrationBean<DoomwatchServletFilter> reg = new FilterRegistrationBean<>();
        reg.setFilter(new DoomwatchServletFilter("order-service", Doomwatch.getInstance().getExporter()));
        reg.addUrlPatterns("/*");
        reg.setOrder(1);
        return reg;
    }
}
```

### 3. Outgoing HTTP Tracing (`RestTemplate`)

Attach `DoomwatchRestTemplateInterceptor` to your Spring `RestTemplate`:

```java
import io.doomwatch.Doomwatch;
import io.doomwatch.client.DoomwatchRestTemplateInterceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

@Configuration
public class RestTemplateConfig {

    @Bean
    public RestTemplate restTemplate() {
        RestTemplate restTemplate = new RestTemplate();
        restTemplate.getInterceptors().add(
            new DoomwatchRestTemplateInterceptor("order-service", Doomwatch.getInstance().getExporter())
        );
        return restTemplate;
    }
}
```

### 4. Manual Span Tracking

```java
import io.doomwatch.Doomwatch;
import io.doomwatch.context.TraceScope;
import io.doomwatch.model.SpanKind;
import java.util.Map;

try (TraceScope scope = Doomwatch.startSpan("processOrderPayment", SpanKind.INTERNAL, Map.of("currency", "USD"))) {
    // Execute business logic
    paymentGateway.charge(order);
}
```
