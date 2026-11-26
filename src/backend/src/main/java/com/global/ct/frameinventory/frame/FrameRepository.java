package com.global.ct.frameinventory.frame;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.namedparam.BeanPropertySqlParameterSource;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
class FrameRepository {
    private static final Logger LOGGER = LoggerFactory.getLogger(FrameRepository.class);

    private static final String SELECT_VERSION = """
        SELECT v.*, r.country_code, r.region_name, t.town_name, p.postcode,
               f.technology_code, f.format_code, f.size_group_code,
               ARRAY(
                   SELECT ARRAY[ref.reference_type, ref.reference_value]
                   FROM frame_version_external_reference ref
                   WHERE ref.version_id = v.version_id
                   ORDER BY ref.reference_type
               ) AS external_references,
               ARRAY(
                   SELECT link.linked_frame_id
                   FROM frame_version_link link
                   WHERE link.version_id = v.version_id
                   ORDER BY link.position
               ) AS linked_frame_ids
        FROM frame_version v
        LEFT JOIN postcode p USING (postcode_id)
        LEFT JOIN town t USING (town_id)
        LEFT JOIN region r USING (region_id)
        LEFT JOIN frame_format f USING (frame_format_id)
        """;

    private final JdbcClient jdbc;

    FrameRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    List<FrameVersion> list(long offset, int limit) {
        return jdbc.sql(SELECT_VERSION + """
            WHERE v.is_current
            ORDER BY v.frame_id
            LIMIT :limit OFFSET :offset
            """)
            .param("limit", limit)
            .param("offset", offset)
            .query(FrameRepository::mapVersion)
            .list();
    }

    long countCurrent() {
        return jdbc.sql("SELECT count(*) FROM frame_version WHERE is_current")
            .query(Long.class)
            .single();
    }

    Optional<FrameVersion> findCurrent(String frameId) {
        return jdbc.sql(SELECT_VERSION + "WHERE v.frame_id = :id AND v.is_current")
            .param("id", frameId)
            .query(FrameRepository::mapVersion)
            .optional();
    }

    List<FrameVersion> history(String frameId) {
        return jdbc.sql(SELECT_VERSION + """
            WHERE v.frame_id = :id
            ORDER BY v.valid_from DESC, v.version_id DESC
            """)
            .param("id", frameId)
            .query(FrameRepository::mapVersion)
            .list();
    }

    FrameVersion findVersion(long versionId) {
        return jdbc.sql(SELECT_VERSION + "WHERE v.version_id = :version")
            .param("version", versionId)
            .query(FrameRepository::mapVersion)
            .single();
    }

    boolean exists(String frameId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM frame WHERE frame_id = :id)")
            .param("id", frameId)
            .query(Boolean.class)
            .single();
    }

    boolean reserveId(String frameId) {
        return jdbc.sql("INSERT INTO frame (frame_id) VALUES (:id) ON CONFLICT (frame_id) DO NOTHING")
            .param("id", frameId)
            .update() == 1;
    }

    boolean lockFrame(String frameId) {
        return jdbc.sql("SELECT frame_id FROM frame WHERE frame_id = :id FOR UPDATE")
            .param("id", frameId)
            .query(String.class)
            .optional()
            .isPresent();
    }

    Optional<Long> currentVersionId(String frameId) {
        return jdbc.sql("SELECT version_id FROM frame_version WHERE frame_id = :id AND is_current")
            .param("id", frameId)
            .query(Long.class)
            .optional();
    }

    OffsetDateTime close(long versionId, String closureSource) {
        return jdbc.sql("""
            UPDATE frame_version
            SET is_current = false,
                valid_to = greatest(clock_timestamp(), valid_from + interval '1 microsecond'),
                closed_by_change_source = :closureSource
            WHERE version_id = :version AND is_current
            RETURNING valid_to
            """)
            .param("version", versionId)
            .param("closureSource", closureSource)
            .query(OffsetDateTime.class)
            .single();
    }

    long append(
        String frameId, FrameAttributes attributes, Long previousVersionId, OffsetDateTime validFrom, String source
    ) {
        Long postcodeId = attributes.location() == null ? null : resolvePostcode(attributes.location());
        Long formatId = attributes.format() == null ? null : resolveFormat(attributes.format());
        var parameters = new MapSqlParameterSource()
            .addValue("frameId", frameId)
            .addValue("postcodeId", postcodeId, Types.BIGINT)
            .addValue("formatId", formatId, Types.BIGINT)
            .addValue("previousVersionId", previousVersionId, Types.BIGINT)
            .addValue("validFrom", validFrom, Types.TIMESTAMP_WITH_TIMEZONE)
            .addValue("source", source);
        var attributeParameters = new BeanPropertySqlParameterSource(attributes);
        for (String property : attributeParameters.getReadablePropertyNames()) {
            parameters.addValue(property, attributeParameters.getValue(property), attributeParameters.getSqlType(property));
        }
        return jdbc.sql("""
            INSERT INTO frame_version (
                frame_id, postcode_id, frame_format_id, source_created_at, source_modified_at, valid_from,
                change_source, status, status_reason, site_no, inventory_site_no, panel_number, location_id,
                environment, address, station, airport, latitude, longitude, distance_to_closest_school,
                size_code, aspect_ratio_code, t_size, pixel_height, pixel_width, illumination_type_id,
                number_of_slots, impact_weight, premium, production_rate_card, production_rate_card_legacy,
                pricing_grade
            )
            SELECT :frameId, :postcodeId, :formatId, previous.source_created_at, previous.source_modified_at,
                   coalesce(CAST(:validFrom AS timestamptz), clock_timestamp()),
                   :source, :status, :statusReason, :siteNo, :inventorySiteNo, :panelNumber, :locationId,
                   :environment, :address, :station, :airport, :latitude, :longitude, :distanceToClosestSchool,
                   :sizeCode, :aspectRatioCode, :tSize, :pixelHeight, :pixelWidth, :illuminationTypeId,
                   :numberOfSlots, :impactWeight, :premium, :productionRateCard, :productionRateCardLegacy,
                   :pricingGrade
            FROM (SELECT 1) seed
            LEFT JOIN frame_version previous ON previous.version_id = :previousVersionId
            RETURNING version_id
            """)
            .paramSource(parameters)
            .query(Long.class)
            .single();
    }

    void copyVersionChildren(long previousVersionId, long newVersionId) {
        jdbc.sql("""
            INSERT INTO frame_version_external_reference (version_id, reference_type, reference_value)
            SELECT :newVersion, reference_type, reference_value
            FROM frame_version_external_reference WHERE version_id = :previousVersion
            """)
            .param("newVersion", newVersionId)
            .param("previousVersion", previousVersionId)
            .update();

        jdbc.sql("""
            INSERT INTO frame_version_link (version_id, position, linked_frame_id)
            SELECT :newVersion, position, linked_frame_id FROM frame_version_link
            WHERE version_id = :previousVersion
            """)
            .param("newVersion", newVersionId)
            .param("previousVersion", previousVersionId)
            .update();
    }

    private long resolvePostcode(FrameAttributes.Location location) {
        var existing = jdbc.sql("""
            SELECT p.postcode_id FROM postcode p
            JOIN town t USING (town_id)
            JOIN region r USING (region_id)
            WHERE r.country_code = :country AND r.region_name = :region
              AND t.town_name = :town AND p.postcode = :postcode
            """)
            .param("country", location.countryCode())
            .param("region", location.region())
            .param("town", location.town())
            .param("postcode", location.postcode())
            .query(Long.class)
            .optional();
        if (existing.isPresent()) {
            return logLookup("postcode", existing.get(), "reused");
        }

        long regionId = jdbc.sql("""
            INSERT INTO region (country_code, region_name) VALUES (:country, :region)
            ON CONFLICT (country_code, region_name) DO UPDATE SET region_name = EXCLUDED.region_name
            RETURNING region_id
            """)
            .param("country", location.countryCode())
            .param("region", location.region())
            .query(Long.class)
            .single();

        long townId = jdbc.sql("""
            INSERT INTO town (region_id, town_name) VALUES (:region, :town)
            ON CONFLICT (region_id, town_name) DO UPDATE SET town_name = EXCLUDED.town_name
            RETURNING town_id
            """)
            .param("region", regionId)
            .param("town", location.town())
            .query(Long.class)
            .single();

        long postcodeId = jdbc.sql("""
            INSERT INTO postcode (town_id, postcode) VALUES (:town, :postcode)
            ON CONFLICT (town_id, postcode) DO UPDATE SET postcode = EXCLUDED.postcode
            RETURNING postcode_id
            """)
            .param("town", townId)
            .param("postcode", location.postcode())
            .query(Long.class)
            .single();
        return logLookup("postcode", postcodeId, "upserted");
    }

    private long resolveFormat(FrameAttributes.Format format) {
        var parameters = new BeanPropertySqlParameterSource(format);
        var existing = jdbc.sql("""
            SELECT frame_format_id FROM frame_format
            WHERE technology_code = :technology AND format_code = :formatCode AND size_group_code = :sizeGroupCode
            """)
            .paramSource(parameters)
            .query(Long.class)
            .optional();
        if (existing.isPresent()) {
            return logLookup("frameFormat", existing.get(), "reused");
        }

        long formatId = jdbc.sql("""
            INSERT INTO frame_format (technology_code, format_code, size_group_code)
            VALUES (:technology, :formatCode, :sizeGroupCode)
            ON CONFLICT (technology_code, format_code, size_group_code)
                DO UPDATE SET format_code = EXCLUDED.format_code
            RETURNING frame_format_id
            """)
            .paramSource(parameters)
            .query(Long.class)
            .single();
        return logLookup("frameFormat", formatId, "upserted");
    }

    private static long logLookup(String lookup, long id, String resolution) {
        LOGGER.atDebug()
            .addKeyValue("lookup", lookup)
            .addKeyValue("lookupId", id)
            .addKeyValue("resolution", resolution)
            .log("frame.lookup_resolved");
        return id;
    }

    private static FrameVersion mapVersion(ResultSet rs, int rowNumber) throws SQLException {
        var attributes = new FrameAttributes(
            rs.getString("status"), rs.getString("status_reason"),
            rs.getString("site_no"), rs.getString("inventory_site_no"), rs.getString("panel_number"),
            rs.getString("location_id"), rs.getString("environment"), rs.getString("address"),
            rs.getString("station"), rs.getString("airport"),
            rs.getBigDecimal("latitude"), rs.getBigDecimal("longitude"),
            rs.getObject("distance_to_closest_school", Integer.class),
            mapLocation(rs), mapFormat(rs), rs.getString("size_code"), rs.getString("aspect_ratio_code"),
            rs.getString("t_size"), rs.getObject("pixel_height", Integer.class),
            rs.getObject("pixel_width", Integer.class), rs.getObject("illumination_type_id", Integer.class),
            rs.getObject("number_of_slots", Integer.class), rs.getBigDecimal("impact_weight"),
            rs.getBoolean("premium"), rs.getString("production_rate_card"),
            rs.getString("production_rate_card_legacy"), rs.getString("pricing_grade")
        );

        return new FrameVersion(
            rs.getString("frame_id"), rs.getLong("version_id"), instant(rs, "valid_from"),
            instant(rs, "valid_to"), rs.getBoolean("is_current"), rs.getString("change_source"),
            rs.getString("closed_by_change_source"), rs.getObject("source_created_at", LocalDateTime.class),
            rs.getObject("source_modified_at", LocalDateTime.class), attributes, mapReferences(rs),
            List.of((String[]) rs.getArray("linked_frame_ids").getArray())
        );
    }

    private static FrameAttributes.Location mapLocation(ResultSet rs) throws SQLException {
        if (rs.getString("postcode") == null) {
            return null;
        }
        return new FrameAttributes.Location(
            rs.getString("country_code"), rs.getString("region_name"),
            rs.getString("town_name"), rs.getString("postcode")
        );
    }

    private static FrameAttributes.Format mapFormat(ResultSet rs) throws SQLException {
        if (rs.getString("format_code") == null) {
            return null;
        }
        return new FrameAttributes.Format(
            rs.getString("technology_code"), rs.getString("format_code"), rs.getString("size_group_code")
        );
    }

    private static Map<String, String> mapReferences(ResultSet rs) throws SQLException {
        Map<String, String> references = new LinkedHashMap<>();
        var rows = (Object[]) rs.getArray("external_references").getArray();
        for (Object row : rows) {
            var reference = (String[]) row;
            references.put(reference[0], reference[1]);
        }
        return references;
    }

    private static Instant instant(ResultSet rs, String field) throws SQLException {
        var date = rs.getObject(field, OffsetDateTime.class);
        return date == null ? null : date.toInstant();
    }
}
