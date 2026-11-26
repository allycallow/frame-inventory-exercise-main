package com.global.ct.frameinventory.frame;

import java.math.BigDecimal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

record FrameAttributes(
    @NotBlank @Pattern(regexp = "LIVE|PENDING|MAINTENANCE|BLOCKED|DRAFT") String status,
    String statusReason,
    String siteNo,
    String inventorySiteNo,
    String panelNumber,
    String locationId,
    String environment,
    String address,
    String station,
    String airport,
    @DecimalMin("-90") @DecimalMax("90") BigDecimal latitude,
    @DecimalMin("-180") @DecimalMax("180") BigDecimal longitude,
    @PositiveOrZero Integer distanceToClosestSchool,
    @Valid Location location,
    @Valid Format format,
    String sizeCode,
    String aspectRatioCode,
    String tSize,
    @Positive Integer pixelHeight,
    @Positive Integer pixelWidth,
    Integer illuminationTypeId,
    @PositiveOrZero Integer numberOfSlots,
    BigDecimal impactWeight,
    boolean premium,
    String productionRateCard,
    String productionRateCardLegacy,
    String pricingGrade
) {
    record Location(
        @NotBlank @Pattern(regexp = "[A-Z]{2}") String countryCode,
        @NotBlank @Size(max = 128) String region,
        @NotBlank @Size(max = 128) String town,
        @NotBlank @Size(max = 32) String postcode
    ) {}

    record Format(
        @NotBlank @Pattern(regexp = "CLASSIC|DIGITAL") String technology,
        @NotBlank @Size(max = 128) String formatCode,
        @NotBlank @Size(max = 128) String sizeGroupCode
    ) {}
}
