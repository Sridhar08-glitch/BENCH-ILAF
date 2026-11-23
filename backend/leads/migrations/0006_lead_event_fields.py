from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('leads', '0005_lead_assignment_webhooks'),
    ]

    operations = [
        migrations.AddField(
            model_name='lead',
            name='tag',
            field=models.CharField(blank=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='lead',
            name='event_name',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='lead',
            name='client_ref',
            field=models.CharField(blank=True, db_index=True, default='', max_length=64),
        ),
    ]
