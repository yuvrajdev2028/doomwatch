package io.doomwatch.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class HttpData {

    @JsonProperty("method")
    private String method;

    @JsonProperty("url")
    private String url;

    @JsonProperty("route")
    private String route;

    @JsonProperty("status_code")
    private Integer statusCode;

    @JsonProperty("request_headers")
    private Map<String, Object> requestHeaders;

    @JsonProperty("request_body")
    private Object requestBody;

    @JsonProperty("response_headers")
    private Map<String, Object> responseHeaders;

    @JsonProperty("response_body")
    private Object responseBody;

    public HttpData() {}

    public HttpData(String method, String url) {
        this.method = method;
        this.url = url;
    }

    public String getMethod() { return method; }
    public void setMethod(String method) { this.method = method; }

    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }

    public String getRoute() { return route; }
    public void setRoute(String route) { this.route = route; }

    public Integer getStatusCode() { return statusCode; }
    public void setStatusCode(Integer statusCode) { this.statusCode = statusCode; }

    public Map<String, Object> getRequestHeaders() { return requestHeaders; }
    public void setRequestHeaders(Map<String, Object> requestHeaders) { this.requestHeaders = requestHeaders; }

    public Object getRequestBody() { return requestBody; }
    public void setRequestBody(Object requestBody) { this.requestBody = requestBody; }

    public Map<String, Object> getResponseHeaders() { return responseHeaders; }
    public void setResponseHeaders(Map<String, Object> responseHeaders) { this.responseHeaders = responseHeaders; }

    public Object getResponseBody() { return responseBody; }
    public void setResponseBody(Object responseBody) { this.responseBody = responseBody; }
}
