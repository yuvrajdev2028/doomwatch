package io.doomwatch.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class DatabaseData {

    @JsonProperty("system")
    private String system;

    @JsonProperty("name")
    private String name;

    @JsonProperty("statement")
    private String statement;

    @JsonProperty("operation")
    private String operation;

    @JsonProperty("collection_or_table")
    private String collectionOrTable;

    @JsonProperty("rows_affected")
    private Integer rowsAffected;

    @JsonProperty("cache_hit")
    private Boolean cacheHit;

    public DatabaseData() {}

    public DatabaseData(String system, String statement) {
        this.system = system;
        this.statement = statement;
    }

    public String getSystem() { return system; }
    public void setSystem(String system) { this.system = system; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getStatement() { return statement; }
    public void setStatement(String statement) { this.statement = statement; }

    public String getOperation() { return operation; }
    public void setOperation(String operation) { this.operation = operation; }

    public String getCollectionOrTable() { return collectionOrTable; }
    public void setCollectionOrTable(String collectionOrTable) { this.collectionOrTable = collectionOrTable; }

    public Integer getRowsAffected() { return rowsAffected; }
    public void setRowsAffected(Integer rowsAffected) { this.rowsAffected = rowsAffected; }

    public Boolean getCacheHit() { return cacheHit; }
    public void setCacheHit(Boolean cacheHit) { this.cacheHit = cacheHit; }
}
