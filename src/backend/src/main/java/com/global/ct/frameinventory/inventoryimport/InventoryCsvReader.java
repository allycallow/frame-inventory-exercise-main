package com.global.ct.frameinventory.inventoryimport;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PushbackReader;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatterBuilder;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.time.temporal.ChronoField;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVRecord;
import org.apache.commons.csv.DuplicateHeaderMode;
import org.springframework.stereotype.Component;

@Component
class InventoryCsvReader {
    static final int MAX_ROWS = 10_000;
    private static final Set<String> HEADER = Set.of((
        "frame_id,type_classic_digital,format,environment,created_date,modified_date,postcode,"
        + "site_no,inventory_site_no,location,postcode_area,postcode_district,postcode_sector,postcode_unit,"
        + "address,region,country_code,town,illumination_type_id,number_of_slots,status,"
        + "status_reason,longitude,latitude,distance_to_closest_school,panel_number,station,size_code,"
        + "size_group_code,impact_weight,production_rate_card,airport,price_entity_id,broadsign_display_unit_id,broadsign_frame_id,"
        + "broadsign_domain_id,linked_frame_ids,aspect_ratio_code,pixel_height,pixel_width,location_id,t_size,"
        + "premium,production_rate_card_legacy,pricing_grade").split(","));
    private static final List<String> TEXT_FIELDS = List.of(
        "status_reason", "site_no", "inventory_site_no", "panel_number", "location_id", "environment",
        "address", "station", "airport", "size_code", "aspect_ratio_code", "t_size",
        "production_rate_card", "production_rate_card_legacy", "pricing_grade");
    private static final Map<String, String> REFERENCES = Map.of(
        "price_entity_id", "PRICE_ENTITY", "broadsign_display_unit_id", "BROADSIGN_DISPLAY_UNIT",
        "broadsign_frame_id", "BROADSIGN_FRAME", "broadsign_domain_id", "BROADSIGN_DOMAIN");
    private static final Set<String> STATUSES = Set.of("LIVE", "PENDING", "MAINTENANCE", "BLOCKED", "DRAFT");
    private static final CSVFormat FORMAT = CSVFormat.RFC4180.builder().setHeader()
        .setSkipHeaderRecord(true).setDuplicateHeaderMode(DuplicateHeaderMode.DISALLOW).get();
    private static final java.time.format.DateTimeFormatter SOURCE_TIME = new DateTimeFormatterBuilder()
        .appendPattern("uuuu-MM-dd HH:mm:ss")
        .optionalStart().appendFraction(ChronoField.NANO_OF_SECOND, 1, 6, true).optionalEnd()
        .toFormatter(java.util.Locale.ROOT).withResolverStyle(ResolverStyle.STRICT);

    private final ObjectMapper mapper;

    InventoryCsvReader(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    int read(InputStream input, Consumer<Row> sink) {
        var utf8 = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT);
        try (var reader = new PushbackReader(new InputStreamReader(input, utf8), 1)) {
            int first = reader.read();
            if (first != -1 && first != '\ufeff') {
                reader.unread(first);
            }
            var parser = parseHeader(reader);
            try (parser) {
                if (!parser.getHeaderMap().keySet().equals(HEADER)) {
                    throw new FileProblem("INVALID_CSV_HEADER");
                }
                int number = 0;
                for (var row : parser) {
                    if (++number > MAX_ROWS) {
                        throw new FileProblem("ROW_LIMIT_EXCEEDED");
                    }
                    sink.accept(parse(number, row, parser.getHeaderMap().get("frame_id")));
                }
                return number;
            }
        } catch (org.apache.commons.csv.CSVException | java.nio.charset.CharacterCodingException invalid) {
            throw new FileProblem("INVALID_CSV");
        } catch (UncheckedIOException wrapped) {
            if (wrapped.getCause() instanceof org.apache.commons.csv.CSVException
                    || wrapped.getCause() instanceof java.nio.charset.CharacterCodingException) {
                throw new FileProblem("INVALID_CSV");
            }
            throw wrapped;
        } catch (IOException inputFailure) {
            throw new UncheckedIOException(inputFailure);
        }
    }

    private static org.apache.commons.csv.CSVParser parseHeader(PushbackReader reader) throws IOException {
        try {
            return FORMAT.parse(reader);
        } catch (IllegalArgumentException invalid) {
            throw new FileProblem("INVALID_CSV_HEADER");
        }
    }

    private Row parse(int number, CSVRecord row, int idIndex) {
        String id = idIndex < row.size() ? text(row.get(idIndex)) : null;
        if (id != null && (id.length() > 128 || id.indexOf('\0') >= 0)) {
            id = null;
        }
        if (!row.isConsistent()) {
            return invalid(number, id, "COLUMN_COUNT", "The record has a different number of fields than the CSV header.");
        }
        if (id == null) {
            return invalid(number, null, "INVALID_FRAME_ID", "Frame ID must contain 1–128 characters.");
        }
        try {
            ObjectNode payload = mapper.createObjectNode();
            for (var field : TEXT_FIELDS) {
                payload.put(field, field(row, field));
            }
            var status = field(row, "status");
            if (status == null || !STATUSES.contains(status)) {
                throw new InvalidField("status");
            }
            payload.put("status", status);
            payload.put("source_created_at", timestamp(row, "created_date", false));
            payload.put("source_modified_at", timestamp(row, "modified_date", true));

            payload.put("longitude", decimal(row, "longitude", 180));
            payload.put("latitude", decimal(row, "latitude", 90));
            payload.put("impact_weight", decimal(row, "impact_weight", 0));
            payload.put("distance_to_closest_school", integer(row, "distance_to_closest_school", 0));
            payload.put("number_of_slots", integer(row, "number_of_slots", 0));
            payload.put("illumination_type_id", integer(row, "illumination_type_id", Integer.MIN_VALUE));
            payload.put("pixel_height", integer(row, "pixel_height", 1));
            payload.put("pixel_width", integer(row, "pixel_width", 1));

            String premium = field(row, "premium");
            if (premium != null && !premium.equals("0") && !premium.equals("1")) {
                throw new InvalidField("premium");
            }
            payload.put("premium", "1".equals(premium));
            addDimensions(row, payload);

            var references = payload.putObject("refs");
            REFERENCES.forEach((column, type) -> {
                var value = field(row, column);
                if (value != null) {
                    references.put(type, value);
                }
            });
            var links = payload.putArray("links");
            var csvLinks = field(row, "linked_frame_ids");
            if (csvLinks != null) {
                for (String target : csvLinks.split(",", -1)) {
                    String normalized = text(target);
                    if (normalized == null || normalized.length() > 128) {
                        throw new InvalidField("linked_frame_ids");
                    }
                    links.add(normalized);
                }
            }
            return new Row(number, id, payload.toString(), null, null);
        } catch (InvalidField invalid) {
            return invalid(number, id, "INVALID_FIELD", "Invalid value for " + invalid.field + ".");
        }
    }

    private static void addDimensions(CSVRecord row, ObjectNode payload) {
        String country = field(row, "country_code");
        String region = field(row, "region");
        String town = field(row, "town");
        String postcode = field(row, "postcode");
        if (country != null || region != null || town != null || postcode != null) {
            if (country == null || !country.matches("[A-Z]{2}")) throw new InvalidField("country_code");
            requireLength(region, 128, "region");
            requireLength(town, 128, "town");
            if (postcode == null || !postcode.matches("[A-Z0-9][A-Z0-9 -]{0,31}")) throw new InvalidField("postcode");
        }
        payload.put("country_code", country).put("region_name", region)
            .put("town_name", town).put("postcode", postcode);

        String technology = field(row, "type_classic_digital");
        String format = field(row, "format");
        String sizeGroup = field(row, "size_group_code");
        if (technology != null || format != null || sizeGroup != null) {
            if (!"CLASSIC".equals(technology) && !"DIGITAL".equals(technology)) {
                throw new InvalidField("type_classic_digital");
            }
            requireLength(format, 128, "format");
            requireLength(sizeGroup, 128, "size_group_code");
        }
        payload.put("technology_code", technology).put("format_code", format).put("size_group_code", sizeGroup);
    }

    private static void requireLength(String value, int max, String field) {
        if (value == null || value.length() > max) throw new InvalidField(field);
    }

    private static String field(CSVRecord row, String name) {
        String value = text(row.get(name));
        if (value != null && value.indexOf('\0') >= 0) {
            throw new InvalidField(name);
        }
        return value;
    }

    private static String text(String value) {
        String trimmed = value.strip();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String timestamp(CSVRecord row, String field, boolean required) {
        String value = field(row, field);
        if (value == null && !required) return null;
        if (value == null) throw new InvalidField(field);
        try {
            var time = LocalDateTime.parse(value, SOURCE_TIME);
            if (time.getYear() < 1) throw new InvalidField(field);
            return time.toString();
        } catch (DateTimeParseException invalid) {
            throw new InvalidField(field);
        }
    }

    private static Integer integer(CSVRecord row, String field, int min) {
        String value = field(row, field);
        if (value == null) return null;
        try {
            int result = Integer.parseInt(value);
            if (result >= min) return result;
        } catch (NumberFormatException invalid) {
            // Report the field without recording the source value.
        }
        throw new InvalidField(field);
    }

    private static BigDecimal decimal(CSVRecord row, String field, int absoluteMax) {
        String value = field(row, field);
        if (value == null) return null;
        if (!value.matches("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)") || value.length() > 128) {
            throw new InvalidField(field);
        }
        var result = new BigDecimal(value).stripTrailingZeros();
        if (absoluteMax > 0 && result.abs().compareTo(BigDecimal.valueOf(absoluteMax)) > 0) {
            throw new InvalidField(field);
        }
        return result;
    }

    private static Row invalid(int number, String id, String code, String detail) {
        return new Row(number, id, null, code, detail);
    }

    record Row(int number, String frameId, String payload, String errorCode, String errorDetail) {}

    static final class FileProblem extends RuntimeException {
        FileProblem(String code) {
            super(code);
        }
    }

    private static final class InvalidField extends RuntimeException {
        private final String field;

        InvalidField(String field) {
            this.field = field;
        }
    }
}
