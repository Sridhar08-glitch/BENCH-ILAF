import uuid

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workspaces', '0011_company_country'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='CustomDomain',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('domain', models.CharField(db_index=True, max_length=253)),
                ('token', models.CharField(max_length=64)),
                ('status', models.CharField(choices=[('pending', 'pending'), ('verified', 'verified'), ('failed', 'failed'), ('expired', 'expired'), ('dns_broken', 'dns_broken')], default='pending', max_length=12)),
                ('requested_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('verified_at', models.DateTimeField(blank=True, null=True)),
                ('last_checked_at', models.DateTimeField(blank=True, null=True)),
                ('last_error', models.CharField(blank=True, default='', max_length=40)),
                ('failing_since', models.DateTimeField(blank=True, null=True)),
                ('broken_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='custom_domain_record', to='workspaces.workspace')),
            ],
        ),
        migrations.AddConstraint(
            model_name='customdomain',
            constraint=models.UniqueConstraint(condition=models.Q(('status__in', ['verified', 'dns_broken'])), fields=('domain',), name='custom_domain_unique_when_verified'),
        ),
    ]
