package com.global.ct.frameinventory.frame;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.function.Consumer;
import java.util.regex.Pattern;

import com.google.protobuf.Timestamp;

import com.global.ct.frameinventory.grpc.v1.Frame;
import com.global.ct.frameinventory.grpc.v1.FrameData;
import com.global.ct.frameinventory.grpc.v1.FrameFormat;
import com.global.ct.frameinventory.grpc.v1.FrameLocation;

final class FrameProtoMapper {
    private static final Pattern DECIMAL = Pattern.compile("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)");

    private FrameProtoMapper() {}

    static FrameAttributes toAttributes(FrameData data) {
        FrameAttributes.Location location = null;
        if (data.hasLocation()) {
            var value = data.getLocation();
            location = new FrameAttributes.Location(
                value.getCountryCode(), value.getRegion(), value.getTown(), value.getPostcode()
            );
        }
        FrameAttributes.Format format = null;
        if (data.hasFormat()) {
            var value = data.getFormat();
            format = new FrameAttributes.Format(value.getTechnology(), value.getFormatCode(), value.getSizeGroupCode());
        }

        return new FrameAttributes(
            data.getStatus(),
            data.hasStatusReason() ? data.getStatusReason() : null,
            data.hasSiteNo() ? data.getSiteNo() : null,
            data.hasInventorySiteNo() ? data.getInventorySiteNo() : null,
            data.hasPanelNumber() ? data.getPanelNumber() : null,
            data.hasLocationId() ? data.getLocationId() : null,
            data.hasEnvironment() ? data.getEnvironment() : null,
            data.hasAddress() ? data.getAddress() : null,
            data.hasStation() ? data.getStation() : null,
            data.hasAirport() ? data.getAirport() : null,
            data.hasLatitude() ? decimal(data.getLatitude(), "attributes.latitude") : null,
            data.hasLongitude() ? decimal(data.getLongitude(), "attributes.longitude") : null,
            data.hasDistanceToClosestSchool() ? data.getDistanceToClosestSchool() : null,
            location,
            format,
            data.hasSizeCode() ? data.getSizeCode() : null,
            data.hasAspectRatioCode() ? data.getAspectRatioCode() : null,
            data.hasTSize() ? data.getTSize() : null,
            data.hasPixelHeight() ? data.getPixelHeight() : null,
            data.hasPixelWidth() ? data.getPixelWidth() : null,
            data.hasIlluminationTypeId() ? data.getIlluminationTypeId() : null,
            data.hasNumberOfSlots() ? data.getNumberOfSlots() : null,
            data.hasImpactWeight() ? decimal(data.getImpactWeight(), "attributes.impactWeight") : null,
            data.getPremium(),
            data.hasProductionRateCard() ? data.getProductionRateCard() : null,
            data.hasProductionRateCardLegacy() ? data.getProductionRateCardLegacy() : null,
            data.hasPricingGrade() ? data.getPricingGrade() : null
        );
    }

    static Frame toProto(FrameVersion version) {
        var frame = Frame.newBuilder()
            .setFrameId(version.frameId())
            .setVersionId(version.versionId())
            .setCurrent(version.current())
            .setValidFrom(timestamp(version.validFrom()))
            .setAttributes(toProto(version.attributes()))
            .putAllExternalReferences(version.externalReferences())
            .addAllLinkedFrameIds(version.linkedFrameIds());
        if (version.validTo() != null) {
            frame.setValidTo(timestamp(version.validTo()));
        }
        if (version.sourceCreatedAt() != null) {
            frame.setSourceCreatedAt(DateTimeFormatter.ISO_LOCAL_DATE_TIME.format(version.sourceCreatedAt()));
        }
        if (version.sourceModifiedAt() != null) {
            frame.setSourceModifiedAt(DateTimeFormatter.ISO_LOCAL_DATE_TIME.format(version.sourceModifiedAt()));
        }
        setIfPresent(version.changeSource(), frame::setChangeSource);
        setIfPresent(version.closedByChangeSource(), frame::setClosedByChangeSource);
        if (version.importJobId() != null) {
            frame.setImportJobId(version.importJobId().toString());
        }
        return frame.build();
    }

    private static FrameData toProto(FrameAttributes attributes) {
        var data = FrameData.newBuilder().setStatus(attributes.status()).setPremium(attributes.premium());
        setIfPresent(attributes.statusReason(), data::setStatusReason);
        setIfPresent(attributes.siteNo(), data::setSiteNo);
        setIfPresent(attributes.inventorySiteNo(), data::setInventorySiteNo);
        setIfPresent(attributes.panelNumber(), data::setPanelNumber);
        setIfPresent(attributes.locationId(), data::setLocationId);
        setIfPresent(attributes.environment(), data::setEnvironment);
        setIfPresent(attributes.address(), data::setAddress);
        setIfPresent(attributes.station(), data::setStation);
        setIfPresent(attributes.airport(), data::setAirport);
        setIfPresent(decimalText(attributes.latitude()), data::setLatitude);
        setIfPresent(decimalText(attributes.longitude()), data::setLongitude);
        setIfPresent(attributes.distanceToClosestSchool(), data::setDistanceToClosestSchool);
        setIfPresent(attributes.sizeCode(), data::setSizeCode);
        setIfPresent(attributes.aspectRatioCode(), data::setAspectRatioCode);
        setIfPresent(attributes.tSize(), data::setTSize);
        setIfPresent(attributes.pixelHeight(), data::setPixelHeight);
        setIfPresent(attributes.pixelWidth(), data::setPixelWidth);
        setIfPresent(attributes.illuminationTypeId(), data::setIlluminationTypeId);
        setIfPresent(attributes.numberOfSlots(), data::setNumberOfSlots);
        setIfPresent(decimalText(attributes.impactWeight()), data::setImpactWeight);
        setIfPresent(attributes.productionRateCard(), data::setProductionRateCard);
        setIfPresent(attributes.productionRateCardLegacy(), data::setProductionRateCardLegacy);
        setIfPresent(attributes.pricingGrade(), data::setPricingGrade);
        if (attributes.location() != null) {
            var location = attributes.location();
            data.setLocation(FrameLocation.newBuilder()
                .setCountryCode(location.countryCode())
                .setRegion(location.region())
                .setTown(location.town())
                .setPostcode(location.postcode()));
        }
        if (attributes.format() != null) {
            var format = attributes.format();
            data.setFormat(FrameFormat.newBuilder()
                .setTechnology(format.technology())
                .setFormatCode(format.formatCode())
                .setSizeGroupCode(format.sizeGroupCode()));
        }
        return data.build();
    }

    private static Timestamp timestamp(Instant value) {
        return Timestamp.newBuilder().setSeconds(value.getEpochSecond()).setNanos(value.getNano()).build();
    }

    private static BigDecimal decimal(String value, String field) {
        if (value.length() > 128 || !DECIMAL.matcher(value).matches()) {
            throw new FrameGrpcExceptionHandler.InvalidField(field, "Must be a decimal string of at most 128 characters.");
        }
        return new BigDecimal(value);
    }

    private static String decimalText(BigDecimal value) {
        return value == null ? null : value.toPlainString();
    }

    private static <T> void setIfPresent(T value, Consumer<T> setter) {
        if (value != null) {
            setter.accept(value);
        }
    }
}
