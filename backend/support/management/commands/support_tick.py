"""The support clock, run every minute from cron: chats nobody answered become tickets, idle chats end, people who
stopped sending heartbeats go away, missed deadlines are reported to the admins and old solved tickets are closed."""
from django.core.management.base import BaseCommand

from support import chat, services


class Command(BaseCommand):
    help = "Run the support background work (chat conversion, away timeout, SLA alerts, closing old solved tickets)."

    def handle(self, *args, **options):
        converted, ended = chat.sweep()
        alerts = services.sweep_sla()
        closed = services.close_old_solved()
        self.stdout.write(f"Support tick: converted={converted} ended={ended} sla_alerts={alerts} closed={closed}")
