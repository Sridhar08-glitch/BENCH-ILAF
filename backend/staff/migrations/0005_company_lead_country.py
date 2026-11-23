from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('staff', '0004_staff_security_and_flag_reasons'),
    ]

    operations = [
        migrations.AddField(
            model_name='companylead',
            name='country',
            field=models.CharField(blank=True, default='', max_length=2),
        ),
    ]
