"""Placing an order from a card's products: checking the cart, taking stock, the number, the lead and the e-mails."""
import re
import uuid
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from cards.models import Product
from workspaces.sharing import card_shares_with_company
from ilaf.emails import send_brand_email
from ilaf.errors import validation_error
from ilaf.i18n import tr
from ilaf.utils import clean_line, clean_multiline, iso
from leads import services as lead_services

from .models import Order, new_number

MAX_LINES = 30
MAX_QTY = 99
EMAIL_OK = serializers.EmailField()
PAYMENT_METHODS = tuple(k for k, _ in Order.PAYMENT_METHODS)
PAYMENT_LABELS = {"cod": "Cash on delivery", "whatsapp": "Pay via WhatsApp", "card_later": "Pay by card later"}


def money(value):
    """A Decimal with two places as text ("42.00")."""
    return f"{Decimal(value).quantize(Decimal('0.01'))}"


def _text(data, name, max_len, errors, multiline=False):
    raw = data.get(name)
    if raw is None:
        return ""
    if not isinstance(raw, str):
        errors[name] = ["Must be text."]
        return ""
    try:
        return clean_multiline(raw, max_len) if multiline else clean_line(raw, max_len)
    except ValidationError as exc:
        errors[name] = [str(m) for m in exc.detail]
        return ""


def clean_customer(data):
    """Name, phone, optional e-mail, note, address and payment method of a public order."""
    errors = {}
    name = _text(data, "name", 120, errors)
    phone = _text(data, "phone", 40, errors)
    email = _text(data, "email", 254, errors)
    note = _text(data, "note", 500, errors, multiline=True)
    address = _text(data, "address", 300, errors)
    if not name and "name" not in errors:
        errors["name"] = ["Enter your name."]
    if not phone and "phone" not in errors:
        errors["phone"] = ["Enter your phone number."]
    elif phone and not re.search(r"\d{6,}", re.sub(r"[\s\-().]", "", phone)):
        errors["phone"] = ["Enter a valid phone number."]
    if email:
        try:
            EMAIL_OK.run_validation(email)
        except ValidationError:
            errors["email"] = ["Enter a valid email address."]
    method = data.get("payment_method") or "cod"
    if method not in PAYMENT_METHODS:
        errors["payment_method"] = ["Choose cash on delivery, WhatsApp or card."]
    if errors:
        raise validation_error(errors)
    return {
        "customer_name": name, "customer_phone": phone, "customer_email": email, "note": note, "address": address,
        "payment_method": method,
    }


def clean_lines(data):
    """[{product_id, qty}] -> [(product_id, qty)] with the obvious mistakes refused."""
    raw = data.get("items")
    if not isinstance(raw, list) or not raw:
        raise validation_error({"items": ["Add something to the cart first."]})
    if len(raw) > MAX_LINES:
        raise validation_error({"items": [f"An order can hold up to {MAX_LINES} different items."]})
    lines = {}
    for entry in raw:
        if not isinstance(entry, dict):
            raise validation_error({"items": ["Each item needs a product and a quantity."]})
        qty = entry.get("qty", 1)
        if not isinstance(qty, int) or isinstance(qty, bool) or not 1 <= qty <= MAX_QTY:
            raise validation_error({"items": [f"Quantities must be between 1 and {MAX_QTY}."]})
        try:
            product_id = str(uuid.UUID(str(entry.get("product_id") or "")))
        except ValueError:
            raise validation_error({"items": ["Each item needs a product and a quantity."]})
        lines[product_id] = lines.get(product_id, 0) + qty
    return list(lines.items())


def _products_for(card, lines):
    ids = [pid for pid, _ in lines]
    return {str(p.id): p for p in Product.objects.select_for_update().filter(card=card, pk__in=ids)}


def place_order(card, data, request=None, lang="en"):
    """Check the cart against the card's products, take stock, and save the order with a fresh number.
    Everything runs in one transaction with the products locked, so two buyers cannot take the last item twice."""
    customer = clean_customer(data)
    lines = clean_lines(data)
    with transaction.atomic():
        products = _products_for(card, lines)
        items, currencies, subtotal = [], set(), Decimal("0")
        for product_id, qty in lines:
            product = products.get(product_id)
            if product is None or not product.on:
                raise validation_error({"items": ["One of the items is no longer available. Please refresh the page."]})
            if product.stock is not None and product.stock < qty:
                raise validation_error({"items": [f"Only {product.stock} of {product.title} left."]})
            currencies.add(product.currency)
            unit = Decimal(product.price)
            subtotal += unit * qty
            items.append({
                "product_id": str(product.id), "title": product.title, "unit_price": money(unit),
                "currency": product.currency, "qty": qty,
            })
        if len(currencies) > 1:
            raise validation_error({"items": ["Items in different currencies cannot be ordered together."]})
        for product_id, qty in lines:
            product = products[product_id]
            if product.stock is not None:
                product.stock -= qty
                product.save(update_fields=["stock", "updated_at"])
        order = None
        for _ in range(8):
            try:
                with transaction.atomic():
                    order = Order.objects.create(
                        number=new_number(), card=card, workspace_id=card.workspace_id, card_name=(card.name or "")[:120],
                        items=items, subtotal=subtotal, total=subtotal, currency=currencies.pop(),
                        consented_at=timezone.now(), shared_with_company=card_shares_with_company(card), **customer,
                    )
                break
            except IntegrityError:
                continue
        if order is None:
            raise validation_error({"items": ["Please try again in a moment."]})
    _lead_for(card, order, data)
    send_customer_receipt(order, lang)
    return order


def summary_lines(order):
    return [f"{line['qty']} x {line['title']}" for line in order.items]


def _lead_for(card, order, data):
    """The buyer lands in the contacts list and rings the bell like any visitor who shared their details."""
    note = f"Order {order.number}: " + ", ".join(summary_lines(order)) + f". Total {order.currency} {money(order.total)}."
    if order.note:
        note += f"\n{order.note}"
    fields = {
        "name": order.customer_name, "email": order.customer_email, "phone": order.customer_phone, "company": "",
        "note": note,
    }
    try:
        lead_services.save_lead(card, "order", fields, data)
    except Exception:  # the order is saved; a contacts problem must not undo it
        pass


def send_customer_receipt(order, lang="en"):
    """E-mail the buyer what they ordered and where to follow it. Never raises; nothing without an address."""
    if not order.customer_email:
        return
    try:
        lines = [tr(lang, "Order number: {value}", value=order.number)]
        lines += summary_lines(order)
        lines.append(tr(lang, "Total: {value}", value=f"{order.currency} {money(order.total)}"))
        lines.append(tr(lang, "Payment: {value}", value=tr(lang, PAYMENT_LABELS[order.payment_method])))
        if order.address:
            lines.append(tr(lang, "Delivery address: {value}", value=order.address))
        send_brand_email(
            order.customer_email, tr(lang, "Your order {number}", number=order.number), tr(lang, "Order received"), lines,
            button_text=tr(lang, "Follow your order"), button_url=f"{settings.WEB_BASE_URL}/order/{order.number}", lang=lang,
        )
    except Exception:
        pass


def phones_match(stored, given):
    """The phone a visitor types matches the one on the order when the digits agree (ignoring spaces, dashes and a
    country code written differently: the last eight digits decide when both are long enough)."""
    a = re.sub(r"\D", "", stored or "")
    b = re.sub(r"\D", "", given or "")
    if not a or not b or len(b) < 6:
        return False
    if a == b:
        return True
    return len(a) >= 8 and len(b) >= 8 and a[-8:] == b[-8:]


def public_json(order):
    """What the buyer sees on the status page."""
    return {
        "number": order.number, "status": order.status, "payment_status": order.payment_status,
        "payment_method": order.payment_method, "pay_url": order.pay_url or None,
        "items": order.items, "subtotal": money(order.subtotal), "total": money(order.total), "currency": order.currency,
        "card_name": order.card.name if order.card_id else order.card_name, "created_at": iso(order.created_at),
    }


def order_json(order):
    """The owner's view of an order."""
    return {
        "id": str(order.id), "number": order.number,
        "card_id": str(order.card_id) if order.card_id else None,
        "card_name": order.card.name if order.card_id else order.card_name,
        "customer_name": order.customer_name, "customer_phone": order.customer_phone, "customer_email": order.customer_email,
        "note": order.note, "address": order.address, "items": order.items,
        "subtotal": money(order.subtotal), "total": money(order.total), "currency": order.currency,
        "payment_method": order.payment_method, "payment_status": order.payment_status, "pay_url": order.pay_url or None,
        "status": order.status, "consented_at": iso(order.consented_at), "shared_with_company": bool(order.shared_with_company),
        "created_at": iso(order.created_at), "updated_at": iso(order.updated_at),
    }


def parse_money(value):
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        return None
