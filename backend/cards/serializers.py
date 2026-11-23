"""Input validation for card writes."""
from django.core.files.storage import default_storage
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from ilaf.design import validate_design, validate_vc
from ilaf.i18n import CARD_LANGUAGES
from ilaf.items import DOWNLOAD_KIND, KINDS, MAX_ITEMS, MAX_LABEL, validate_icon, validate_value
from ilaf.utils import absolute_url, clean_line, clean_multiline

from .slugs import normalise_slug


def media_prefixes(request):
    """URL prefixes under which our own uploaded icons live (an icon must point at one of them)."""
    base = default_storage.url("icons/x")[: -len("x")]
    prefixes = {base, absolute_url(request, base)}
    return tuple(prefixes)


def file_prefixes(request):
    """URL prefixes under which uploaded PDFs live: a "Download file" button must point at one of them."""
    base = default_storage.url("files/x")[: -len("x")]
    return tuple({base, absolute_url(request, base)})


class ItemSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    kind = serializers.ChoiceField(choices=KINDS)
    value = serializers.CharField(required=False, allow_blank=True, default="", trim_whitespace=True)
    label = serializers.CharField(required=False, allow_blank=True, default="", trim_whitespace=True)
    on = serializers.BooleanField(required=False, default=True)
    order = serializers.IntegerField(required=False)
    icon = serializers.JSONField(required=False, allow_null=True, default=None)

    def validate(self, attrs):
        errors = {}
        try:
            attrs["value"] = validate_value(attrs["kind"], attrs.get("value", ""))
        except ValidationError as exc:
            errors["value"] = [str(m) for m in exc.detail]
        if attrs["kind"] == DOWNLOAD_KIND and attrs.get("value") and "value" not in errors:
            if not any(attrs["value"].startswith(p) for p in file_prefixes(self.context.get("request"))):
                errors["value"] = ["Upload the PDF first and use the address we returned."]
        try:
            attrs["label"] = clean_line(attrs.get("label", ""), MAX_LABEL)
        except ValidationError as exc:
            errors["label"] = [str(m) for m in exc.detail]
        try:
            attrs["icon"] = validate_icon(attrs.get("icon"), media_prefixes(self.context.get("request")))
        except ValidationError as exc:
            errors["icon"] = [str(m) for m in exc.detail]
        if errors:
            raise ValidationError(errors)
        return attrs


class CardWriteSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True)
    title = serializers.CharField(required=False, allow_blank=True)
    company = serializers.CharField(required=False, allow_blank=True)
    address = serializers.CharField(required=False, allow_blank=True)
    label = serializers.CharField(required=False, allow_blank=True)
    is_default = serializers.BooleanField(required=False)
    save_contact = serializers.BooleanField(required=False)
    language = serializers.ChoiceField(choices=CARD_LANGUAGES, required=False)
    hide_from_directory = serializers.BooleanField(required=False)
    seo_indexable = serializers.BooleanField(required=False)
    slug = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    vc = serializers.JSONField(required=False)
    features = serializers.JSONField(required=False)
    design = serializers.JSONField(required=False)
    items = ItemSerializer(many=True, required=False)

    def validate_name(self, value):
        return clean_line(value, 120)

    def validate_title(self, value):
        return clean_line(value, 120)

    def validate_company(self, value):
        return clean_line(value, 120)

    def validate_label(self, value):
        return clean_line(value, 40)

    def validate_address(self, value):
        return clean_multiline(value, 300)

    def validate_slug(self, value):
        return normalise_slug(value) or None

    # These only check the values. The write code merges the partial input onto the stored
    # settings, so the original partial dict is returned untouched.
    def validate_vc(self, value):
        validate_vc(value)
        return value

    def validate_design(self, value):
        validate_design(value)
        return value

    def validate_items(self, value):
        if len(value) > MAX_ITEMS:
            raise ValidationError(f"A card can have at most {MAX_ITEMS} items.")
        return value
