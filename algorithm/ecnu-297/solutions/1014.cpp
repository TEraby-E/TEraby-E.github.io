#include <iostream>
#include <limits>
#include <string>
using namespace std;

int main() {
    int n;
    if (!(cin >> n)) return 0;
    cin.ignore(numeric_limits<streamsize>::max(), '\n');
    string s;
    getline(cin, s);
    for (int left = 0, right = n - 1; left <= right;) {
        // 两端相等时继续向内比较，直到能分出取哪一端更小。
        int i = left, j = right;
        while (i < j && s[i] == s[j]) {
            ++i;
            --j;
        }
        if (i >= j || static_cast<unsigned char>(s[i]) < static_cast<unsigned char>(s[j])) {
            cout << s[left++];
        } else {
            cout << s[right--];
        }
    }
    cout << '\n';
}
