package io.doomwatch.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.io.PrintWriter;
import java.io.StringWriter;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class SpanError {

    @JsonProperty("name")
    private String name;

    @JsonProperty("message")
    private String message;

    @JsonProperty("stack")
    private String stack;

    public SpanError() {}

    public SpanError(String name, String message, String stack) {
        this.name = name;
        this.message = message;
        this.stack = stack;
    }

    public static SpanError fromThrowable(Throwable throwable) {
        if (throwable == null) {
            return null;
        }
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        throwable.printStackTrace(pw);
        return new SpanError(
                throwable.getClass().getSimpleName(),
                throwable.getMessage() != null ? throwable.getMessage() : throwable.toString(),
                sw.toString()
        );
    }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    public String getStack() { return stack; }
    public void setStack(String stack) { this.stack = stack; }
}
