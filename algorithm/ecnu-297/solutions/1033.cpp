#include <iostream>
#include <string>
#include <vector>

using namespace std;

bool isDigit(char ch) {
    return ch >= '0' && ch <= '9';
}

vector<long long> parse(const string& expression) {
    vector<long long> coefficients(50);
    size_t pos = 0;
    while (pos < expression.size()) {
        int sign = 1;
        if (expression[pos] == '+' || expression[pos] == '-') {
            if (expression[pos++] == '-') sign = -1;
        }
        long long value = 0;
        bool explicitValue = false;
        while (pos < expression.size() && isDigit(expression[pos])) {
            value = value * 10 + expression[pos++] - '0';
            explicitValue = true;
        }
        int power = 0;
        if (pos < expression.size() && expression[pos] == 'x') {
            ++pos;
            if (!explicitValue) value = 1;
            power = 1;
            if (pos < expression.size() && expression[pos] == '^') {
                ++pos;
                power = 0;
                while (pos < expression.size() && isDigit(expression[pos])) {
                    power = power * 10 + expression[pos++] - '0';
                }
            }
        }
        coefficients[power] += sign * value;
    }
    return coefficients;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    string first, second;
    while (cin >> first >> second) {
        vector<long long> a = parse(first), b = parse(second);
        vector<long long> product(a.size() + b.size() - 1);
        for (size_t i = 0; i < a.size(); ++i) {
            for (size_t j = 0; j < b.size(); ++j) {
                product[i + j] += a[i] * b[j];
            }
        }
        bool printed = false;
        for (int i = static_cast<int>(product.size()) - 1; i >= 0; --i) {
            if (product[i] == 0) continue;
            if (printed) cout << ' ';
            cout << product[i];
            printed = true;
        }
        cout << '\n';
    }
}
